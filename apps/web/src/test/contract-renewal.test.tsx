import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, post } from "../api";
import { ContractRenewalSection } from "../components/ContractRenewal";
import type { MaintenanceContract } from "../contract-contracts";

vi.mock("../auth", () => ({ manager: { getUser: vi.fn() } }));
vi.mock("../api", () => ({ api: vi.fn(), post: vi.fn() }));

const contract = {
  id: "source-agreement",
  status: "Active",
  version: 7,
  expiresAtUtc: "2027-11-15T12:34:56.789Z",
} as MaintenanceContract;
const renewal = {
  id: "renewal-evidence",
  sourceContractId: contract.id,
  renewedContractId: "new-draft",
  sourceVersion: 7,
  effectiveFromUtc: "2027-11-15T12:34:57Z",
  expiresAtUtc: "2028-11-15T12:34:57Z",
  recordedAtUtc: "2026-11-15T12:00:00Z",
  reason: "Continue annual maintenance",
  actorId: "manager",
  actorRole: "OperationsManager",
};
beforeEach(() => {
  vi.mocked(api).mockReset().mockResolvedValue([]);
  vi.mocked(post).mockReset().mockResolvedValue(renewal);
});
function show() {
  const onOpen = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ContractRenewalSection contract={contract} onOpen={onOpen} />
    </QueryClientProvider>,
  );
  return onOpen;
}

it("submits an explicit renewal window and current source version, then opens the new draft", async () => {
  const onOpen = show();
  const submit = await screen.findByRole("button", {
    name: "Create renewal draft",
  });
  const starts = screen.getByLabelText(/^Renewal starts/) as HTMLInputElement;
  expect(new Date(starts.value).getTime()).toBeGreaterThanOrEqual(
    new Date(contract.expiresAtUtc!).getTime(),
  );
  fireEvent.change(screen.getByLabelText(/^Renewal reason/), {
    target: { value: renewal.reason },
  });
  fireEvent.click(submit);
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      `/api/contracts/${contract.id}/renewals`,
      expect.objectContaining({
        expectedVersion: 7,
        reason: renewal.reason,
        effectiveFromUtc: new Date(starts.value).toISOString(),
        operationId: expect.any(String),
      }),
    ),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Open renewal draft" }),
  );
  expect(onOpen).toHaveBeenCalledWith("new-draft");
});

it("shows the existing successor and prevents a second renewal command", async () => {
  vi.mocked(api).mockResolvedValue([renewal]);
  const onOpen = show();
  fireEvent.click(
    await screen.findByRole("button", { name: "View renewed agreement" }),
  );
  expect(onOpen).toHaveBeenCalledWith("new-draft");
  expect(
    screen.queryByRole("button", { name: "Create renewal draft" }),
  ).not.toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});
