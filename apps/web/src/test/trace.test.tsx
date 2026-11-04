import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { User } from "oidc-client-ts";
import { TraceEvidence } from "../components/TraceEvidence";
import { manager } from "../auth";

vi.mock("../auth", () => ({ manager: { getUser: vi.fn() } }));
const traceId = "0123456789abcdef0123456789abcdef";
const checkedAtUtc = "2026-11-04T18:00:00Z";
const fetchMock = vi.fn<typeof fetch>();
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
const renderTrace = () =>
  render(
    <TraceEvidence
      workOrderId="order-1"
      traceId={traceId}
      correlationId="correlation-1"
    />,
  );
const check = async () =>
  userEvent.click(
    screen.getByRole("button", { name: "Check trace availability" }),
  );

describe("authorized trace availability", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(manager.getUser).mockResolvedValue({
      access_token: "test-access-token",
      expired: false,
    } as User);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the authenticated same-origin replay endpoint and shows a trace link only after confirmed availability", async () => {
    fetchMock.mockResolvedValue(
      response({
        available: true,
        reason: "available",
        checkedAtUtc,
        spanCount: 3,
      }),
    );
    renderTrace();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    await check();
    expect(
      await screen.findByRole("link", { name: "Open trace in Jaeger" }),
    ).toHaveAttribute("href", `http://localhost:16686/trace/${traceId}`);
    expect(screen.getByText(/3 recorded spans/)).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      `/api/replay/order-1/traces/${traceId}/availability`,
    );
    expect(
      (fetchMock.mock.calls[0][1]?.headers as Headers).get("Authorization"),
    ).toBe("Bearer test-access-token");
  });

  it("distinguishes authorized missing or expired trace metadata from an inaccessible work order", async () => {
    fetchMock.mockResolvedValue(
      response(
        {
          available: false,
          reason: "not_retained",
          checkedAtUtc,
          spanCount: 0,
        },
        404,
      ),
    );
    renderTrace();
    await check();
    expect(await screen.findByText(/It may have expired/)).toBeVisible();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/may not have permission/),
    ).not.toBeInTheDocument();
  });

  it("reports an unreachable provider as unknown without claiming the trace expired or showing a public link", async () => {
    fetchMock.mockResolvedValue(
      response(
        {
          available: false,
          reason: "unreachable",
          checkedAtUtc,
          spanCount: null,
        },
        503,
      ),
    );
    renderTrace();
    await check();
    expect(
      await screen.findByText(/Trace availability is currently unknown/),
    ).toHaveTextContent("The trace provider is unreachable.");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText(/It may have expired/)).not.toBeInTheDocument();
  });

  it.each([403, 404])(
    "does not disclose availability for a restricted work order returning %i ProblemDetails",
    async (status) => {
      fetchMock.mockResolvedValue(
        response({ status, title: "Resource is not accessible" }, status),
      );
      renderTrace();
      await check();
      expect(
        await screen.findByText(
          /Trace availability is not accessible for this work order/,
        ),
      ).toBeVisible();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      expect(screen.queryByText(/It may have expired/)).not.toBeInTheDocument();
    },
  );

  it("does not infer availability from an unexpected raw-trace response", async () => {
    fetchMock.mockResolvedValue(
      response({ data: [{ spans: [{ operationName: "private-span" }] }] }),
    );
    renderTrace();
    await check();
    expect(
      await screen.findByText(/Trace availability could not be confirmed/),
    ).toBeVisible();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText("private-span")).not.toBeInTheDocument();
  });
});
