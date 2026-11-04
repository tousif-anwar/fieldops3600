using System.Security.Claims;
using System.Text.Json;
using FieldOps.Core;
using Microsoft.AspNetCore.Authentication;

namespace FieldOps.ServiceHost;

public sealed class KeycloakClaims : IClaimsTransformation
{
    public Task<ClaimsPrincipal> TransformAsync(ClaimsPrincipal principal)
    {
        if (principal.Identity is not ClaimsIdentity identity || !identity.IsAuthenticated) return Task.FromResult(principal);
        var realm = principal.FindFirst("realm_access")?.Value;
        if (realm is not null)
        {
            using var doc = JsonDocument.Parse(realm);
            if (doc.RootElement.TryGetProperty("roles", out var roles))
                foreach (var role in roles.EnumerateArray())
                    if (!principal.IsInRole(role.GetString()!)) identity.AddClaim(new Claim(ClaimTypes.Role, role.GetString()!));
        }
        return Task.FromResult(principal);
    }
}

public sealed record Caller(string Id, string TeamId, string Role, bool IsAdministrator, bool IsTechnician)
{
    public static Caller From(ClaimsPrincipal principal)
    {
        var id = principal.FindFirst("sub")?.Value ?? throw new DomainException(401, "Missing subject.");
        var team = principal.FindFirst("team_id")?.Value ?? principal.FindFirst("teamId")?.Value ?? "";
        var role = new[] { "Administrator", "OperationsManager", "Supervisor", "Dispatcher", "Analyst", "Technician" }.FirstOrDefault(principal.IsInRole) ?? "Unknown";
        return new(id, team, role, principal.IsInRole("Administrator"), principal.IsInRole("Technician"));
    }
    public bool CanAccess(string team, string? technicianId = null) => IsAdministrator || (TeamId.Length > 0 && team == TeamId && (!IsTechnician || technicianId == Id));
    public void Demand(string team, string? technicianId = null)
    {
        if (!CanAccess(team, technicianId)) throw new DomainException(404, "The requested resource was not found.");
    }
}

public static class EventFactory
{
    public static AuditEvent Create(HttpContext? http, string service, string type, Guid orderId, object payload, long sequence,
        DateTimeOffset now, Guid? workflowId = null, Guid? stageId = null, Guid? causationId = null)
    {
        var actor = http?.User.Identity?.IsAuthenticated == true ? Caller.From(http.User) : new Caller("system", "", "System", false, false);
        var correlation = http?.Items["CorrelationId"]?.ToString() ?? Guid.NewGuid().ToString("N");
        var activity = System.Diagnostics.Activity.Current;
        return new(Guid.NewGuid(), type, 1, orderId, workflowId, stageId, actor.Id, actor.Role, service, correlation,
            causationId, activity?.TraceId.ToString(), activity?.SpanId.ToString(), now, now, sequence,
            JsonSerializer.SerializeToElement(payload, Json.Options));
    }
}

