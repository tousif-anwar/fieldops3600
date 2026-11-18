import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ContractSlaTermsEditor } from "../components/ContractSlaTermsEditor";
import type { MaintenanceContract } from "../contract-contracts";
import { ApiError, api } from "../api";

vi.mock("../auth", () => ({ manager: { getUser: vi.fn() } }));
vi.mock("../api", async (original) => ({
  ...(await original<typeof import("../api")>()),
  api: vi.fn(),
}));

const agreement = {
  id: "agreement-1",
  version: 11,
  status: "Active",
  slaClockOrigin: null,
  lines: [
    { id: "hvac-line", serviceType: "HVAC", active: true },
    { id: "controls-line", serviceType: "Controls", active: false },
  ],
} as MaintenanceContract;

beforeEach(() =>
  vi
    .mocked(api)
    .mockReset()
    .mockResolvedValue({ contractId: agreement.id, version: 12 }),
);
function show(contract = agreement) {
  const onSaved = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const refresh = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <ContractSlaTermsEditor contract={contract} onSaved={onSaved} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByText("Change agreement service targets"));
  fireEvent.change(screen.getByLabelText(/^Service target change reason/), {
    target: { value: "Agreed elapsed service targets for future work" },
  });
  return { onSaved, refresh };
}
const field = (service: string, target: "starts" | "completes") =>
  screen.getByLabelText(`${service} service ${target} within (minutes)`);
const change = (
  service: string,
  target: "starts" | "completes",
  value: string,
) => fireEvent.change(field(service, target), { target: { value } });
const save = () =>
  fireEvent.click(screen.getByRole("button", { name: "Save service targets" }));
function body() {
  const [path, request] = vi.mocked(api).mock.calls[0];
  expect(path).toBe("/api/contracts/agreement-1/sla-terms");
  expect(request?.method).toBe("PUT");
  return JSON.parse(request?.body as string);
}

it("leaves the origin and all targets unset, including inactive lines", async () => {
  const { refresh } = show();
  expect(screen.getByLabelText("Service target clock")).toHaveValue("");
  expect(field("HVAC", "starts")).toHaveValue(null);
  expect(field("HVAC", "completes")).toHaveValue(null);
  expect(field("Controls", "starts")).toHaveValue(null);
  save();
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  expect(body()).toMatchObject({
    expectedVersion: 11,
    clockOrigin: null,
    lines: [
      {
        contractLineId: "hvac-line",
        responseTargetMinutes: null,
        completionTargetMinutes: null,
      },
      {
        contractLineId: "controls-line",
        responseTargetMinutes: null,
        completionTargetMinutes: null,
      },
    ],
  });
  await waitFor(() =>
    expect(refresh).toHaveBeenCalledWith({
      queryKey: ["contract", agreement.id],
    }),
  );
  expect(refresh).toHaveBeenCalledWith({ queryKey: ["contracts"] });
});

it("submits both target types for every line with the operator's explicit clock and current version", async () => {
  const { onSaved } = show();
  fireEvent.change(screen.getByLabelText("Service target clock"), {
    target: { value: "AppointmentStart" },
  });
  change("HVAC", "starts", "30");
  change("HVAC", "completes", "120");
  change("Controls", "completes", "240");
  save();
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(body()).toMatchObject({
    expectedVersion: 11,
    clockOrigin: "AppointmentStart",
    lines: [
      {
        contractLineId: "hvac-line",
        responseTargetMinutes: 30,
        completionTargetMinutes: 120,
      },
      {
        contractLineId: "controls-line",
        responseTargetMinutes: null,
        completionTargetMinutes: 240,
      },
    ],
  });
  expect(body().operationId).toEqual(expect.any(String));
});

it("requires an explicit origin when any target is entered", async () => {
  show();
  change("HVAC", "starts", "30");
  save();
  expect(
    await screen.findByText(
      "Select a clock origin before setting service targets.",
    ),
  ).toBeInTheDocument();
  expect(api).not.toHaveBeenCalled();
  expect(field("HVAC", "starts")).toHaveValue(30);
});

it("rejects completion before service start because both use the same origin", async () => {
  show();
  fireEvent.change(screen.getByLabelText("Service target clock"), {
    target: { value: "WorkOrderCreated" },
  });
  change("HVAC", "starts", "60");
  change("HVAC", "completes", "30");
  save();
  expect(
    await screen.findByText(/service completion target must be at or after/),
  ).toBeInTheDocument();
  expect(api).not.toHaveBeenCalled();
});

it("preserves entered terms and reason when the owner rejects a stale version", async () => {
  vi.mocked(api).mockRejectedValue(
    new ApiError(
      409,
      "The agreement changed; refresh before changing SLA terms.",
    ),
  );
  const { onSaved, refresh } = show();
  fireEvent.change(screen.getByLabelText("Service target clock"), {
    target: { value: "AppointmentStart" },
  });
  change("HVAC", "starts", "90");
  change("HVAC", "completes", "360");
  save();
  expect(
    await screen.findByText(/agreement changed; refresh/),
  ).toBeInTheDocument();
  expect(field("HVAC", "starts")).toHaveValue(90);
  expect(field("HVAC", "completes")).toHaveValue(360);
  expect(screen.getByLabelText(/^Service target change reason/)).toHaveValue(
    "Agreed elapsed service targets for future work",
  );
  expect(
    screen.getByRole("button", { name: "Save service targets" }),
  ).toBeEnabled();
  expect(body().expectedVersion).toBe(11);
  expect(onSaved).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
});

it("clears all previously configured targets explicitly without dropping a line", async () => {
  show({
    ...agreement,
    slaClockOrigin: "WorkOrderCreated",
    lines: agreement.lines.map((line) => ({
      ...line,
      responseTargetMinutes: 30,
      completionTargetMinutes: 120,
    })),
  });
  fireEvent.click(screen.getByRole("button", { name: "Clear all targets" }));
  expect(screen.getByLabelText("Service target clock")).toHaveValue("");
  save();
  await waitFor(() => expect(api).toHaveBeenCalledOnce());
  expect(body().lines).toHaveLength(2);
  expect(
    body().lines.every(
      (line: {
        responseTargetMinutes: number | null;
        completionTargetMinutes: number | null;
      }) =>
        line.responseTargetMinutes === null &&
        line.completionTargetMinutes === null,
    ),
  ).toBe(true);
  expect(body().clockOrigin).toBeNull();
});
