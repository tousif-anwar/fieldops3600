import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import {
  locationAddress,
  type CustomerServiceContext,
} from "../customer-contracts";
import { ErrorState, Loading, Panel, Status } from "./common";
import type { WorkOrder } from "../types";

export function CustomerServiceDetails({ order }: { order: WorkOrder }) {
  const auth = useAuth();
  const query = useQuery({
    queryKey: ["customer-service-context", order.id, order.customerId],
    queryFn: () =>
      api<CustomerServiceContext>(
        `/api/customers/${order.customerId}/service-context?workOrderId=${encodeURIComponent(order.id)}`,
      ),
    enabled: !!order.customerId,
    staleTime: 0,
  });
  if (!order.customerId)
    return (
      <Panel title="Customer reference">
        <p className="customer-note">
          {order.unregisteredCustomerReason ??
            "Legacy order without a customer registry reference."}
        </p>
      </Panel>
    );
  return (
    <Panel title="Customer and service location">
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        <div className="form-body">
          <h3>
            {auth.can("Dispatcher", "Supervisor", "OperationsManager") ? (
              <Link to={`/customers/${query.data.customerId}`}>
                {query.data.displayName}
              </Link>
            ) : (
              query.data.displayName
            )}
          </h3>
          <p>
            {query.data.location.name}{" "}
            <Status value={query.data.location.status} />
          </p>
          <p>{locationAddress(query.data.location)}</p>
          {query.data.location.accessNotes && (
            <p>Access notes: {query.data.location.accessNotes}</p>
          )}
          {query.data.contacts.map((c) => (
            <section key={c.id}>
              <strong>
                {c.fullName}
                {c.isPrimary ? " (primary)" : ""}
              </strong>
              {c.email && (
                <p>
                  Email: {c.email}. Consent{" "}
                  {c.emailConsent ? "recorded" : "not recorded"}.
                </p>
              )}
              {c.phone && (
                <p>
                  Phone: {c.phone}. Consent{" "}
                  {c.phoneConsent ? "recorded" : "not recorded"}.
                </p>
              )}
            </section>
          ))}
          <p>
            Preferred communication: {query.data.preferredChannel}. Contact
            requires recorded consent.
          </p>
        </div>
      )}
    </Panel>
  );
}
