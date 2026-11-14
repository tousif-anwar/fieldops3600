export interface AssignmentOffer {
  id: string;
  workOrderId: string;
  technicianId: string;
  teamId: string;
  workOrderNumber: string;
  title: string;
  siteAddress: string;
  serviceCategory: string;
  priority: string;
  startUtc: string;
  endUtc: string;
  expiresAtUtc: string;
  status: "Pending" | "Accepted" | "Declined" | "Revoked" | "Expired";
  version: number;
  createdAtUtc: string;
  respondedAtUtc?: string | null;
  reason?: string | null;
  bookingId?: string | null;
}

// Expiry is also checked by the server before any response is committed.
export function offerStatus(offer: AssignmentOffer, now = Date.now()) {
  return offer.status === "Pending" && Date.parse(offer.expiresAtUtc) <= now
    ? "Expired"
    : offer.status;
}
