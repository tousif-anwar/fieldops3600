using System.Diagnostics;
using System.Security.Claims;
using System.Text.Json;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.IdentityModel.Tokens;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using Serilog;
using Serilog.Formatting.Compact;
using Yarp.ReverseProxy.Configuration;
using Yarp.ReverseProxy.Forwarder;

var builder = WebApplication.CreateBuilder(args);
builder.Host.UseSerilog((_, log) => log
    .MinimumLevel.Override("Microsoft.AspNetCore", Serilog.Events.LogEventLevel.Warning)
    .MinimumLevel.Override("Microsoft.IdentityModel", Serilog.Events.LogEventLevel.Warning)
    .WriteTo.Console(new RenderedCompactJsonFormatter()));
builder.Services.AddProblemDetails();
var issuer = builder.Configuration["Auth:Authority"] ?? "http://localhost:8080/realms/fieldops";
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(options =>
{
    options.Authority = issuer;
    options.MetadataAddress = builder.Configuration["Auth:MetadataAddress"] ?? $"{issuer}/.well-known/openid-configuration";
    options.Audience = "fieldops-api";
    options.RequireHttpsMetadata = !builder.Environment.IsDevelopment();
    options.MapInboundClaims = false;
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidIssuer = issuer,
        ValidateIssuer = true,
        ValidateAudience = true,
        ValidateLifetime = true,
        ValidateIssuerSigningKey = true,
        ClockSkew = TimeSpan.FromSeconds(30),
        RoleClaimType = "role",
        NameClaimType = "preferred_username"
    };
    options.Events = new JwtBearerEvents
    {
        OnTokenValidated = context =>
        {
            // Accept only signed realm roles, never role/team headers supplied by callers.
            if (context.Principal?.Identity is ClaimsIdentity identity &&
                context.Principal.FindFirst("realm_access")?.Value is string realm)
            {
                using var json = JsonDocument.Parse(realm);
                if (json.RootElement.TryGetProperty("roles", out var roles))
                    foreach (var role in roles.EnumerateArray())
                        if (role.GetString() is string value) identity.AddClaim(new Claim("role", value));
            }
            return Task.CompletedTask;
        },
        OnMessageReceived = context =>
        {
            // SignalR's browser transport uses a query token. Never enable query auth for other APIs.
            if (context.Request.Path.StartsWithSegments("/hubs/notifications") &&
                context.Request.Query.TryGetValue("access_token", out var token))
                context.Token = token;
            return Task.CompletedTask;
        }
    };
});
builder.Services.AddAuthorization(options =>
{
    options.FallbackPolicy = new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build();
    options.AddPolicy("optimizer", policy => policy.RequireRole("Dispatcher", "Supervisor", "OperationsManager", "Administrator"));
});
builder.Services.AddCors(options => options.AddDefaultPolicy(policy => policy
    .WithOrigins((builder.Configuration["Web:Origins"] ?? "http://localhost:5173,http://localhost:8088").Split(','))
    .AllowAnyHeader().AllowAnyMethod()));
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.User.FindFirst("sub")?.Value ?? context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions { PermitLimit = 240, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
});
builder.Services.AddHttpClient("readiness", client => client.Timeout = TimeSpan.FromSeconds(3));
builder.Services.AddHealthChecks().AddCheck<UpstreamReadiness>("business-services", tags: ["ready"]);
builder.Services.AddOpenTelemetry().ConfigureResource(resource => resource.AddService("fieldops-gateway"))
    .WithTracing(trace => trace.AddAspNetCoreInstrumentation(options => options.Filter = c => !c.Request.Path.StartsWithSegments("/health"))
        .AddHttpClientInstrumentation().AddOtlpExporter());

var servicePaths = new Dictionary<string, string[]>
{
    ["customers"] = ["/api/customers/{**remaining}", "/api/customer-portal/account"],
    ["assets"] = ["/api/assets/{**remaining}", "/api/customer-portal/equipment"],
    ["work-orders"] = ["/api/work-orders/{**remaining}", "/api/service-requests/{**remaining}", "/api/customer-portal/work-orders/{**remaining}"],
    ["technicians"] = ["/api/technicians/{**remaining}"],
    ["scheduling"] = ["/api/bookings/{**remaining}", "/api/scheduling/{**remaining}", "/api/assignment-offers/{**remaining}", "/api/customer-portal/appointments"],
    ["workflows"] = ["/api/workflows/{**remaining}"],
    ["notifications"] = ["/api/notifications/{**remaining}", "/hubs/notifications/{**remaining}"],
    ["reporting"] = ["/api/reports/{**remaining}", "/api/replay/{**remaining}"],
    ["inventory"] = ["/api/inventory/{**remaining}"]
};
var routes = new List<RouteConfig>();
var clusters = new List<ClusterConfig>();
var businessAddresses = new Dictionary<string, string>();
var port = 5101;
foreach (var (service, paths) in servicePaths)
{
    var address = builder.Configuration[$"Services:{service}"] ?? $"http://localhost:{port}";
    businessAddresses.Add(service, address);
    clusters.Add(new ClusterConfig
    {
        ClusterId = service,
        Destinations = new Dictionary<string, DestinationConfig>
        {
            ["primary"] = new() { Address = address }
        },
        HttpRequest = new ForwarderRequestConfig { ActivityTimeout = TimeSpan.FromSeconds(45) }
    });
    port++;
    foreach (var path in paths)
        routes.Add(new RouteConfig { RouteId = $"{service}-{routes.Count}", ClusterId = service, Match = new RouteMatch { Path = path } });
}
builder.Services.AddSingleton(new BusinessServiceEndpoints(businessAddresses));
clusters.Add(new ClusterConfig
{
    ClusterId = "optimizer",
    Destinations = new Dictionary<string, DestinationConfig>
    {
        ["primary"] = new() { Address = builder.Configuration["Services:optimizer"] ?? "http://localhost:8001" }
    }
});
routes.Add(new RouteConfig
{
    RouteId = "optimizer",
    ClusterId = "optimizer",
    AuthorizationPolicy = "optimizer",
    Match = new RouteMatch { Path = "/api/optimizer/{**remaining}" },
    Transforms = [new Dictionary<string, string> { ["PathRemovePrefix"] = "/api/optimizer" }]
});
builder.Services.AddReverseProxy().LoadFromMemory(routes, clusters);
var app = builder.Build();
app.UseExceptionHandler();
app.Use(async (context, next) =>
{
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["Referrer-Policy"] = "no-referrer";
    context.Response.Headers["Cache-Control"] = "no-store";
    context.Response.Headers["X-Correlation-ID"] = Activity.Current?.TraceId.ToString() ?? context.TraceIdentifier;
    // Strip spoofed internal identity headers before forwarding.
    foreach (var header in new[] { "X-User-Id", "X-User-Role", "X-Team-Id", "X-Internal-Auth" })
        context.Request.Headers.Remove(header);
    await next();
});
app.UseSerilogRequestLogging(options => options.GetLevel = (context, _, exception) => exception is not null
    ? Serilog.Events.LogEventLevel.Error : context.Response.StatusCode >= 500
    ? Serilog.Events.LogEventLevel.Error : Serilog.Events.LogEventLevel.Information);
app.UseCors();
app.UseAuthentication();
app.UseRateLimiter();
app.UseAuthorization();
app.MapHealthChecks("/health/live", new Microsoft.AspNetCore.Diagnostics.HealthChecks.HealthCheckOptions { Predicate = _ => false }).AllowAnonymous();
app.MapHealthChecks("/health/ready", new Microsoft.AspNetCore.Diagnostics.HealthChecks.HealthCheckOptions { Predicate = check => check.Tags.Contains("ready") }).AllowAnonymous();
app.MapGet("/api/session", (ClaimsPrincipal user) => Results.Ok(new
{
    id = user.FindFirst("sub")?.Value,
    name = user.Identity?.Name,
    teamId = user.FindFirst("team_id")?.Value,
    roles = user.FindAll("role").Select(claim => claim.Value).Distinct()
}));
app.MapReverseProxy();
app.Run();

public sealed record BusinessServiceEndpoints(IReadOnlyDictionary<string, string> Addresses);

public sealed class UpstreamReadiness(IHttpClientFactory clients, BusinessServiceEndpoints services) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        var checks = services.Addresses.Values.Select(async address =>
        {
            try
            {
                using var response = await clients.CreateClient("readiness").GetAsync(address.TrimEnd('/') + "/health/ready", cancellationToken);
                return response.IsSuccessStatusCode;
            }
            catch (HttpRequestException) { return false; }
            catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested) { return false; }
        });
        return (await Task.WhenAll(checks)).All(healthy => healthy)
            ? HealthCheckResult.Healthy() : HealthCheckResult.Unhealthy("A required business service is not ready.");
    }
}
