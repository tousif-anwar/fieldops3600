import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { Empty, ErrorState, Loading, Panel, Status } from "./common";
import type { PortalAgreement } from "../contract-contracts";
import type { PortalEquipment } from "../service-request-contracts";

const dateOnly = (value?: string | null) =>
  value ? new Date(`${value}T00:00:00`).toLocaleDateString() : "—";

export function PortalAgreements() {
  const agreements = useQuery({
    queryKey: ["portal-agreements"],
    queryFn: () => api<PortalAgreement[]>("/api/customer-portal/agreements"),
  });
  const equipment = useQuery({
    queryKey: ["portal-equipment"],
    queryFn: () => api<PortalEquipment[]>("/api/customer-portal/equipment"),
  });
  if (agreements.isPending) return <Loading label="Loading your agreements…" />;
  if (agreements.isError)
    return (
      <ErrorState
        error={agreements.error}
        retry={() => void agreements.refetch()}
      />
    );
  if (agreements.data.length === 0)
    return (
      <Panel title="Maintenance agreements">
        <Empty
          title="No active maintenance agreement"
          description="Your service team has not registered an active agreement for this account."
        />
      </Panel>
    );
  return (
    <Panel
      title="Maintenance agreements"
      description="Covered services, remaining visit allowances, and upcoming maintenance visits."
    >
      {agreements.data.map((agreement) => (
        <section className="customer-subrecord" key={agreement.id}>
          <h3>
            <Status value={agreement.status} /> · Effective{" "}
            {dateOnly(agreement.effectiveFromUtc.slice(0, 10))}
          </h3>
          <p>Expires {dateOnly(agreement.expiresAtUtc?.slice(0, 10))}</p>
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Agreement coverage"
          >
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Service</th>
                  <th scope="col">Labor</th>
                  <th scope="col">Parts</th>
                  <th scope="col">Visits remaining</th>
                </tr>
              </thead>
              <tbody>
                {agreement.lines.map((line) => (
                  <tr key={line.id}>
                    <td>{line.serviceType}</td>
                    <td>{line.laborCovered ? "Covered" : "Not covered"}</td>
                    <td>{line.partsCovered ? "Covered" : "Not covered"}</td>
                    <td>{line.visitsRemaining ?? "Unlimited"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h4>Covered equipment</h4>
          {agreement.coversAllAssets ? (
            <p>
              All equipment owned by your account, subject to the agreement's
              service exclusions.
            </p>
          ) : (
            <>
              {equipment.error ? (
                <ErrorState
                  error={equipment.error}
                  retry={() => void equipment.refetch()}
                />
              ) : null}
              <ul>
                {agreement.coveredAssets.map((covered) => (
                  <li key={covered.assetId}>
                    {equipment.data?.find(
                      (asset) => asset.id === covered.assetId,
                    )?.name ?? "Registered equipment"}{" "}
                    · {covered.active ? "Active" : "Inactive"} ·{" "}
                    {dateOnly(covered.effectiveFrom)} →{" "}
                    {dateOnly(covered.effectiveTo)}
                  </li>
                ))}
              </ul>
            </>
          )}
          <h4>Upcoming maintenance</h4>
          {agreement.upcomingVisits.length === 0 ? (
            <p>No upcoming generated visits.</p>
          ) : (
            <ul>
              {agreement.upcomingVisits.map((visit) => (
                <li key={visit.id}>
                  {dateOnly(visit.dueDate)} · {visit.status}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </Panel>
  );
}
