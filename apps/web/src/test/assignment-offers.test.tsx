import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Schedule } from "../pages/Schedule";
import { AssignmentOffers } from "../components/AssignmentOffers";
import { offerStatus, type AssignmentOffer } from "../assignment-contracts";
import { api, post } from "../api";

vi.mock("../auth", () => ({ useAuth: () => ({ can: () => true }) }));
vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  api: vi.fn(),
  post: vi.fn(),
}));

const offer: AssignmentOffer = {
  id: "offer-1",
  workOrderId: "order-1",
  technicianId: "tech-01",
  teamId: "north",
  workOrderNumber: "WO-100",
  title: "Inspect cooling unit",
  siteAddress: "10 Test Street",
  serviceCategory: "HVAC",
  priority: "High",
  startUtc: "2099-11-14T14:00:00Z",
  endUtc: "2099-11-14T16:00:00Z",
  expiresAtUtc: "2099-11-13T14:00:00Z",
  status: "Pending",
  version: 4,
  createdAtUtc: "2099-11-13T13:30:00Z",
};

function mount(children: React.ReactNode) {
  return render(
    <MemoryRouter>
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: {
              queries: { retry: false },
              mutations: { retry: false },
            },
          })
        }
      >
        {children}
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(post).mockReset();
  vi.mocked(api)
    .mockReset()
    .mockImplementation(async (path) => {
      if (path === "/api/work-orders")
        return [
          {
            id: "order-1",
            number: "WO-100",
            title: offer.title,
            status: "Created",
          },
        ];
      return [];
    });
});

async function planOffer() {
  mount(<Schedule />);
  await screen.findByRole("option", { name: "WO-100 — Inspect cooling unit" });
  await userEvent.selectOptions(screen.getByLabelText(/Work order/), "order-1");
  await userEvent.click(
    screen.getByRole("button", { name: "Find qualified technicians" }),
  );
  await screen.findByRole("heading", { name: "Recommended technicians" });
  await userEvent.click(screen.getByRole("radio"));
  await userEvent.selectOptions(
    screen.getByLabelText("Assignment method"),
    "offer",
  );
}

describe("dispatcher assignment offers", () => {
  it("records an offer without claiming that a booking is confirmed", async () => {
    vi.mocked(post).mockImplementation(async (path) =>
      path === "/api/scheduling/recommendations"
        ? [{ technicianId: "tech-01", technicianName: "Jordan Lee", score: 1 }]
        : offer,
    );
    await planOffer();
    await userEvent.click(
      screen.getByRole("button", { name: "Send assignment offer" }),
    );
    await screen.findByText(
      "Offer sent. Awaiting technician acceptance; no booking is confirmed yet.",
    );
    expect(post).toHaveBeenCalledWith(
      "/api/assignment-offers",
      expect.objectContaining({
        workOrderId: "order-1",
        technicianId: "tech-01",
        idempotencyKey: expect.any(String),
        expiresAtUtc: expect.any(String),
      }),
    );
    expect(
      vi.mocked(post).mock.calls.some(([path]) => path === "/api/bookings"),
    ).toBe(false);
    expect(
      screen.queryByText("Booking confirmed. The technician is now assigned."),
    ).not.toBeInTheDocument();
  });

  it("reuses the original command on a retry after a lost response", async () => {
    let attempts = 0;
    vi.mocked(post).mockImplementation(async (path) => {
      if (path === "/api/scheduling/recommendations")
        return [{ technicianId: "tech-01", score: 1 }];
      attempts++;
      if (attempts === 1) throw new Error("Network response unavailable.");
      return offer;
    });
    await planOffer();
    await userEvent.click(
      screen.getByRole("button", { name: "Send assignment offer" }),
    );
    await screen.findByText(/Network response unavailable/);
    await userEvent.click(
      screen.getByRole("button", { name: "Send assignment offer" }),
    );
    await screen.findByText(
      "Offer sent. Awaiting technician acceptance; no booking is confirmed yet.",
    );
    const commands = vi
      .mocked(post)
      .mock.calls.filter(([path]) => path === "/api/assignment-offers");
    expect(commands).toHaveLength(2);
    expect(commands[0][1]).toEqual(commands[1][1]);
  });

  it("revokes a pending offer with its version and a retained reason", async () => {
    vi.mocked(api).mockResolvedValue([offer]);
    vi.mocked(post).mockResolvedValue({
      ...offer,
      status: "Revoked",
      version: 5,
    });
    mount(<AssignmentOffers technicians={[]} canManage />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Revoke offer" }),
    );
    await userEvent.type(
      screen.getByLabelText("Reason for revoking", { exact: false }),
      "Customer requested another date",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm revocation" }),
    );
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/api/assignment-offers/offer-1/revoke",
        {
          expectedVersion: 4,
          reason: "Customer requested another date",
          idempotencyKey: expect.any(String),
        },
      ),
    );
  });

  it("shows expiry and decline history without offering a stale action", async () => {
    vi.mocked(api).mockResolvedValue([
      { ...offer, expiresAtUtc: "2000-01-01T00:00:00Z" },
      {
        ...offer,
        id: "declined-1",
        status: "Declined",
        reason: "Vehicle unavailable",
      },
    ]);
    mount(<AssignmentOffers technicians={[]} canManage />);
    await screen.findByText("No pending offers");
    await userEvent.click(
      screen.getByRole("button", { name: "Show offer history" }),
    );
    expect(screen.getByText("Expired")).toBeInTheDocument();
    expect(screen.getByText("Reason: Vehicle unavailable")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Revoke offer" }),
    ).not.toBeInTheDocument();
    expect(offerStatus(offer, Date.parse(offer.expiresAtUtc))).toBe("Expired");
  });
});
