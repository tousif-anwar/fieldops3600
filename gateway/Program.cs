using System.Diagnostics;
using System.Security.Claims;
using System.Text.Json;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.IdentityModel.Tokens;
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
    options.AddPolicy("intelligence", policy => policy.RequireRole("Dispatcher", "Supervisor", "OperationsManager", "Administrator"));
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
builder.Services.AddHealthChecks();
builder.Services.AddOpenTelemetry().ConfigureResource(resource => resource.AddService("fieldops-gateway"))
    .WithTracing(trace => trace.AddAspNetCoreInstrumentation(options => options.Filter = c => !c.Request.Path.StartsWithSegments("/health"))
        .AddHttpClientInstrumentation().AddOtlpExporter());

var servicePaths = new Dictionary<string, string[]>
{
    ["work-orders"] = ["/api/work-orders/{**remaining}"],
    ["technicians"] = ["/api/technicians/{**remaining}"],
    ["scheduling"] = ["/api/bookings/{**remaining}", "/api/scheduling/{**remaining}"],
    ["workflows"] = ["/api/workflows/{**remaining}"],
    ["notifications"] = ["/api/notifications/{**remaining}", "/hubs/notifications/{**remaining}"],
    ["reporting"] = ["/api/reports/{**remaining}", "/api/replay/{**remaining}"]
};
var routes = new List<RouteConfig>();
var clusters = new List<ClusterConfig>();
var port = 5101;
foreach (var (service, paths) in servicePaths)
{
    clusters.Add(new ClusterConfig
    {
        ClusterId = service,
        Destinations = new Dictionary<string, DestinationConfig>
        {
            ["primary"] = new() { Address = builder.Configuration[$"Services:{service}"] ?? $"http://localhost:{port}" }
        },
        HttpRequest = new ForwarderRequestConfig { ActivityTimeout = TimeSpan.FromSeconds(45) }
    });
    port++;
    foreach (var path in paths)
        routes.Add(new RouteConfig { RouteId = $"{service}-{routes.Count}", ClusterId = service, Match = new RouteMatch { Path = path } });
}
clusters.Add(new ClusterConfig
{
    ClusterId = "intelligence",
    Destinations = new Dictionary<string, DestinationConfig>
    {
        ["primary"] = new() { Address = builder.Configuration["Services:intelligence"] ?? "http://localhost:8001" }
    }
});
routes.Add(new RouteConfig
{
    RouteId = "intelligence",
    ClusterId = "intelligence",
    AuthorizationPolicy = "intelligence",
    Match = new RouteMatch { Path = "/api/intelligence/{**remaining}" },
    Transforms = [new Dictionary<string, string> { ["PathRemovePrefix"] = "/api/intelligence" }]
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
app.MapHealthChecks("/health/live").AllowAnonymous();
app.MapGet("/api/session", (ClaimsPrincipal user) => Results.Ok(new
{
    id = user.FindFirst("sub")?.Value,
    name = user.Identity?.Name,
    teamId = user.FindFirst("team_id")?.Value,
    roles = user.FindAll("role").Select(claim => claim.Value).Distinct()
}));
app.MapReverseProxy();
app.Run();
