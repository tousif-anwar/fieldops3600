using System.Text.Json;
using FieldOps.Core;

namespace FieldOps.ServiceHost;

public sealed record TraceAvailability(bool Available, string Reason, DateTimeOffset CheckedAtUtc, int? SpanCount);
public sealed record TraceProbeResult(TraceAvailability Response, int HttpStatus);

public static class TraceProbe
{
    public static void ValidateId(string traceId)
    {
        if (traceId.Length != 32 || !traceId.All(Uri.IsHexDigit)) throw new DomainException(400, "Trace IDs must contain exactly 32 hexadecimal characters.");
    }

    public static async Task<TraceProbeResult> Check(string? endpoint, string traceId, HttpClient client, TimeProvider clock, CancellationToken ct)
    {
        ValidateId(traceId);
        TraceProbeResult Unavailable(string reason, int status = 503) => new(new(false, reason, clock.GetUtcNow(), status == 404 ? 0 : null), status);
        if (string.IsNullOrWhiteSpace(endpoint)) return Unavailable("not_configured");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct); timeout.CancelAfter(TimeSpan.FromSeconds(3));
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, endpoint.TrimEnd('/') + "/api/traces/" + traceId.ToLowerInvariant());
            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
            if (response.StatusCode == System.Net.HttpStatusCode.NotFound) return Unavailable("not_retained", 404);
            if (!response.IsSuccessStatusCode) return Unavailable("upstream_error");
            await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
            using var document = await JsonDocument.ParseAsync(stream, new JsonDocumentOptions { MaxDepth = 64 }, timeout.Token);
            var count = RetainedSpanCount(document.RootElement, traceId);
            return count > 0 ? new(new(true, "available", clock.GetUtcNow(), count), 200) : Unavailable("not_retained", 404);
        }
        catch (HttpRequestException) { return Unavailable("unreachable"); }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested) { return Unavailable("timeout"); }
        catch (JsonException) { return Unavailable("upstream_error"); }
    }

    public static int RetainedSpanCount(JsonElement root, string traceId)
    {
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Array) return 0;
        return data.EnumerateArray().Where(trace => trace.TryGetProperty("traceID", out var id) && id.ValueKind == JsonValueKind.String && string.Equals(id.GetString(), traceId, StringComparison.OrdinalIgnoreCase))
            .Sum(trace => trace.TryGetProperty("spans", out var spans) && spans.ValueKind == JsonValueKind.Array ? spans.GetArrayLength() : 0);
    }
}
