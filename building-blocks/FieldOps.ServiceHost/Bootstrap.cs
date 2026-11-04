using System.Security.Claims;
using FieldOps.Core;
using MassTransit;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.IdentityModel.Tokens;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using Prometheus;
using Quartz;
using Serilog;

namespace FieldOps.ServiceHost;

public static class Bootstrap
{
    public static async Task Run(string[] args, string service)
    {
        var builder = WebApplication.CreateBuilder(args);
        builder.Host.UseSerilog((context, logger) => logger.ReadFrom.Configuration(context.Configuration).MinimumLevel.Override("Microsoft.AspNetCore", Serilog.Events.LogEventLevel.Warning).MinimumLevel.Override("Microsoft.IdentityModel", Serilog.Events.LogEventLevel.Warning).MinimumLevel.Override("Microsoft.EntityFrameworkCore.Database.Command", Serilog.Events.LogEventLevel.Warning).Enrich.FromLogContext().WriteTo.Console());
        builder.Services.AddSingleton(new ServiceIdentity(service));
        builder.Services.AddSingleton(TimeProvider.System);
        builder.Services.AddDbContext<ServiceDb>(options => options.UseNpgsql(builder.Configuration.GetConnectionString("Database") ?? throw new InvalidOperationException("ConnectionStrings:Database is required.")).ReplaceService<IModelCacheKeyFactory, ServiceModelKeyFactory>());
        builder.Services.AddHttpClient("services", client => client.Timeout = TimeSpan.FromSeconds(12));
        builder.Services.AddScoped<RemoteServices>();
        builder.Services.AddSignalR();
        builder.Services.AddHealthChecks().AddCheck<DatabaseReadiness>("postgresql", tags: ["ready"]);
        builder.Services.AddProblemDetails();
        builder.Services.ConfigureHttpJsonOptions(options => options.SerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase);
        builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(options =>
        {
            options.Authority = builder.Configuration["Auth:Authority"] ?? "http://localhost:8080/realms/fieldops";
            options.Audience = builder.Configuration["Auth:Audience"] ?? "fieldops-api";
            options.MetadataAddress = builder.Configuration["Auth:MetadataAddress"] ?? options.Authority + "/.well-known/openid-configuration";
            options.RequireHttpsMetadata = builder.Configuration.GetValue("Auth:RequireHttpsMetadata", !builder.Environment.IsDevelopment());
            if (!builder.Environment.IsDevelopment() && !options.RequireHttpsMetadata) throw new InvalidOperationException("HTTPS discovery is required outside Development.");
            options.MapInboundClaims = false;
            options.TokenValidationParameters = new TokenValidationParameters { ValidateIssuer = true, ValidateAudience = true, ValidateLifetime = true, ValidateIssuerSigningKey = true, NameClaimType = "preferred_username", RoleClaimType = ClaimTypes.Role, ClockSkew = TimeSpan.FromSeconds(30), ValidIssuer = options.Authority };
            options.Events = new JwtBearerEvents { OnMessageReceived = context => { if (context.HttpContext.Request.Path.StartsWithSegments("/hubs/notifications") && context.Request.Query.TryGetValue("access_token", out var token)) context.Token = token; return Task.CompletedTask; } };
        });
        builder.Services.AddTransient<IClaimsTransformation, KeycloakClaims>();
        builder.Services.AddAuthorization(options =>
        {
            options.AddPolicy("operational", p => p.RequireAuthenticatedUser().RequireRole("Technician", "Dispatcher", "Supervisor", "OperationsManager", "Administrator"));
            options.AddPolicy("execute", p => p.RequireAuthenticatedUser().RequireRole("Technician", "Supervisor", "OperationsManager", "Administrator"));
            options.AddPolicy("dispatch", p => p.RequireAuthenticatedUser().RequireRole("Dispatcher", "Supervisor", "OperationsManager", "Administrator"));
            options.AddPolicy("supervise", p => p.RequireAuthenticatedUser().RequireRole("Supervisor", "OperationsManager", "Administrator"));
            options.AddPolicy("report", p => p.RequireAuthenticatedUser().RequireRole("Analyst", "Supervisor", "OperationsManager", "Administrator"));
            options.AddPolicy("replay", p => p.RequireAuthenticatedUser().RequireRole("Supervisor", "Administrator"));
            options.AddPolicy("admin", p => p.RequireAuthenticatedUser().RequireRole("Administrator"));
        });
        builder.Services.AddOpenTelemetry().ConfigureResource(r => r.AddService($"fieldops-{service}")).WithTracing(t => t.AddAspNetCoreInstrumentation().AddHttpClientInstrumentation().AddSource("MassTransit", "FieldOps").AddOtlpExporter());
        var messagingEnabled = builder.Configuration.GetValue("Messaging:Enabled", true);
        if (messagingEnabled)
        {
            builder.Services.AddMassTransit(config =>
            {
                if (service is "work-orders" or "notifications" or "reporting") config.AddConsumer<OperationalConsumer>();
                config.UsingRabbitMq((context, rabbit) =>
                {
                    rabbit.Host(builder.Configuration["RabbitMq:Host"] ?? "localhost", builder.Configuration["RabbitMq:VirtualHost"] ?? "/", host => { host.Username(builder.Configuration["RabbitMq:Username"] ?? throw new InvalidOperationException("RabbitMq:Username is required.")); host.Password(builder.Configuration["RabbitMq:Password"] ?? throw new InvalidOperationException("RabbitMq:Password is required.")); });
                    if (service is "work-orders" or "notifications" or "reporting") rabbit.ReceiveEndpoint($"fieldops-{service}-events", endpoint => { endpoint.UseMessageRetry(retry => retry.Intervals(TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(3), TimeSpan.FromSeconds(10))); endpoint.ConcurrentMessageLimit = 1; endpoint.ConfigureConsumer<OperationalConsumer>(context); });
                });
            });
            builder.Services.AddHostedService<OutboxDispatcher>();
        }
        if (builder.Configuration.GetValue<bool>("Demo:EnableConsumerFailure") && !builder.Environment.IsDevelopment()) throw new InvalidOperationException("Failure injection is development-only.");
        var policy = new SlaPolicy(builder.Configuration.GetValue("Sla:DurationSeconds", 1800), builder.Configuration.GetValue("Sla:WarningSeconds", 1200), builder.Configuration.GetValue("Sla:CriticalSeconds", 1500));
        policy.Validate(builder.Environment.IsDevelopment()); builder.Services.AddSingleton(policy);
        if (service == "workflows")
        {
            builder.Services.AddQuartz(q => { var job = new JobKey("persistent-state-sla-sweep"); q.AddJob<SlaSweep>(j => j.WithIdentity(job)); q.AddTrigger(t => t.ForJob(job).WithIdentity("sla-sweep").WithSimpleSchedule(s => s.WithIntervalInSeconds(builder.Environment.IsDevelopment() ? 1 : 10).RepeatForever()).StartNow()); });
            builder.Services.AddQuartzHostedService(options => options.WaitForJobsToComplete = true);
        }
        var app = builder.Build();
        app.Use(async (http, next) =>
        {
            var supplied = http.Request.Headers["X-Correlation-ID"].ToString();
            var correlation = Guid.TryParse(supplied, out var parsed) ? parsed.ToString() : Guid.NewGuid().ToString();
            http.Items["CorrelationId"] = correlation; http.Response.Headers["X-Correlation-ID"] = correlation;
            http.Response.Headers["X-Content-Type-Options"] = "nosniff";
            http.Response.Headers["Cache-Control"] = "no-store";
            try { await next(); }
            catch (DomainException ex) { await Results.Problem(statusCode: ex.Status, title: "Request could not be completed", detail: ex.Message).ExecuteAsync(http); }
            catch (DbUpdateConcurrencyException) { await Results.Problem(statusCode: 409, title: "Concurrent update", detail: "This resource changed. Refresh it and try again.").ExecuteAsync(http); }
            catch (DbUpdateException ex) when (ex.InnerException is Npgsql.PostgresException pg && pg.SqlState is "23P01" or "23505") { await Results.Problem(statusCode: 409, title: "Conflicting operation", detail: "The booking overlaps existing work, the work order is already booked, or this request was already processed. Refresh before retrying.").ExecuteAsync(http); }
            catch (Exception ex) when (ex is not OperationCanceledException) { app.Logger.LogError(ex, "Request {CorrelationId} failed", correlation); await Results.Problem(statusCode: 500, title: "Service error", detail: $"The request could not be completed. Reference: {correlation}").ExecuteAsync(http); }
        });
        app.UseSerilogRequestLogging(); app.UseHttpMetrics();
        app.UseAuthentication(); app.UseAuthorization();
        app.MapGet("/health/live", () => Results.Ok(new { service, status = "live" }));
        app.MapHealthChecks("/health/ready", new Microsoft.AspNetCore.Diagnostics.HealthChecks.HealthCheckOptions { Predicate = x => x.Tags.Contains("ready") });
        // Metrics are intentionally bound on the internal service network by Compose.
        app.MapMetrics();
        OperationsApi.Map(app, service);
        if (service == "notifications") { ReportingApi.Map(app); app.MapHub<NotificationHub>("/hubs/notifications"); }
        if (service == "reporting") ReportingApi.MapReporting(app);
        await DatabaseBootstrap.Initialize(app);
        if (args.Contains("--migrate-only", StringComparer.Ordinal)) return;
        await app.RunAsync();
    }
}

public sealed class DatabaseReadiness(IServiceScopeFactory scopes) : Microsoft.Extensions.Diagnostics.HealthChecks.IHealthCheck
{
    public async Task<Microsoft.Extensions.Diagnostics.HealthChecks.HealthCheckResult> CheckHealthAsync(Microsoft.Extensions.Diagnostics.HealthChecks.HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        await using var scope = scopes.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<ServiceDb>();
        return await db.Database.CanConnectAsync(cancellationToken) ? Microsoft.Extensions.Diagnostics.HealthChecks.HealthCheckResult.Healthy() : Microsoft.Extensions.Diagnostics.HealthChecks.HealthCheckResult.Unhealthy("Database unavailable");
    }
}
