using System.Net;
using System.Text;
using System.Text.Json;
using FieldOps.Core;
using FieldOps.ServiceHost;
using Xunit;

namespace FieldOps.Tests;

public sealed class TraceProbeTests
{
    private const string Trace = "0123456789abcdef0123456789abcdef";

    private sealed class ResponseHandler(HttpStatusCode status, string content) : HttpMessageHandler
    {
        public Uri? Requested { get; private set; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requested = request.RequestUri;
            return Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(content, Encoding.UTF8, "application/json") });
        }
    }

    [Fact]
    public async Task RetainedTraceReturnsOnlyAvailabilityAndCountWithoutDisclosingSpans()
    {
        var handler = new ResponseHandler(HttpStatusCode.OK, "{\"data\":[{\"traceID\":\"" + Trace + "\",\"spans\":[{\"privateTag\":\"customer-secret\"},{}]}]}");
        using var client = new HttpClient(handler);
        var result = await TraceProbe.Check("http://jaeger:16686", Trace, client, TimeProvider.System, CancellationToken.None);
        Assert.Equal(200, result.HttpStatus); Assert.True(result.Response.Available); Assert.Equal(2, result.Response.SpanCount);
        Assert.Equal("/api/traces/" + Trace, handler.Requested!.AbsolutePath);
        Assert.DoesNotContain("customer-secret", Json.Write(result.Response));
    }

    [Fact]
    public async Task MissingExpiredAndUnavailableTracesHaveExplicitDistinctResponses()
    {
        using var missing = new HttpClient(new ResponseHandler(HttpStatusCode.NotFound, "{}"));
        var result = await TraceProbe.Check("http://jaeger:16686", Trace, missing, TimeProvider.System, CancellationToken.None);
        Assert.Equal(404, result.HttpStatus); Assert.Equal("not_retained", result.Response.Reason); Assert.False(result.Response.Available);
        using var broken = new HttpClient(new ResponseHandler(HttpStatusCode.ServiceUnavailable, "{}"));
        Assert.Equal("upstream_error", (await TraceProbe.Check("http://jaeger:16686", Trace, broken, TimeProvider.System, CancellationToken.None)).Response.Reason);
        Assert.Equal("not_configured", (await TraceProbe.Check(null, Trace, missing, TimeProvider.System, CancellationToken.None)).Response.Reason);
    }

    [Fact]
    public void InvalidIdsAndUnrelatedUpstreamTracesCannotBecomeAvailable()
    {
        Assert.Throws<DomainException>(() => TraceProbe.ValidateId("../../api/traces"));
        Assert.Throws<DomainException>(() => TraceProbe.ValidateId(new string('g', 32)));
        using var unrelated = JsonDocument.Parse("{\"data\":[{\"traceID\":\"different\",\"spans\":[{}]}]}");
        Assert.Equal(0, TraceProbe.RetainedSpanCount(unrelated.RootElement, Trace));
    }
}
