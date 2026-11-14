import { useQuery } from "@tanstack/react-query";
import { Button } from "@fluentui/react-components";
import { api } from "../api";
import { dateTime } from "../format";
import { ErrorState, Loading, PageHeader, Panel } from "../components/common";

interface CustomerMetrics {
  registeredCustomers: number;
  activeCustomers: number;
  archivedCustomers: number;
  contactCount: number;
  locationCount: number;
  activeLocationCount: number;
  emailConsentCount: number;
  phoneConsentCount: number;
  linkedWorkOrders: number;
  unregisteredWorkOrders: number;
  pendingCustomerVersions: number;
  refreshedAtUtc: string | null;
  breakdown: { customerType: string; status: string; count: number }[];
}
interface AssetMetrics {
  registeredAssets: number;
  activeAssets: number;
  inactiveAssets: number;
  retiredAssets: number;
  warrantyExpiring90Days: number;
  customersWithAssets: number;
  linkedWorkOrders: number;
  pendingAssetVersions: number;
  refreshedAtUtc: string | null;
  byType: { assetType: string; count: number }[];
}
function Figures({ rows }: { rows: [string, number][] }) {
  return (
    <dl className="detail-list">
      {rows.map(([name, value]) => (
        <div key={name}>
          <dt>{name}</dt>
          <dd>{value.toLocaleString()}</dd>
        </div>
      ))}
    </dl>
  );
}
export function RegistryInsights() {
  const customers = useQuery({
    queryKey: ["registry-customer-metrics"],
    queryFn: () => api<CustomerMetrics>("/api/reports/customers"),
    refetchInterval: 30000,
  });
  const assets = useQuery({
    queryKey: ["registry-asset-metrics"],
    queryFn: () => api<AssetMetrics>("/api/reports/assets"),
    refetchInterval: 30000,
  });
  return (
    <>
      <PageHeader
        title="Customer and asset insights"
        actions={
          <Button
            onClick={() => {
              void customers.refetch();
              void assets.refetch();
            }}
          >
            Refresh registry metrics
          </Button>
        }
      />
      <div className="detail-grid">
        <Panel
          title="Customer registry"
          description="Consent counts refer to contacts, not customers."
        >
          {customers.isPending ? (
            <Loading />
          ) : customers.isError ? (
            <ErrorState
              error={customers.error}
              retry={() => void customers.refetch()}
            />
          ) : (
            <>
              <Figures
                rows={[
                  ["Registered customers", customers.data.registeredCustomers],
                  ["Active customers", customers.data.activeCustomers],
                  ["Archived customers", customers.data.archivedCustomers],
                  ["Active locations", customers.data.activeLocationCount],
                  ["Contacts", customers.data.contactCount],
                  [
                    "Contacts with email consent",
                    customers.data.emailConsentCount,
                  ],
                  [
                    "Contacts with phone consent",
                    customers.data.phoneConsentCount,
                  ],
                  ["Linked work orders", customers.data.linkedWorkOrders],
                  [
                    "Legacy or exception orders",
                    customers.data.unregisteredWorkOrders,
                  ],
                  [
                    "Versions awaiting source evidence",
                    customers.data.pendingCustomerVersions,
                  ],
                ]}
              />
              <p className="customer-note">
                Refreshed:{" "}
                {customers.data.refreshedAtUtc
                  ? dateTime(customers.data.refreshedAtUtc)
                  : "Awaiting customer events"}
                . Counts include the authorized team's whole registry and do not
                use the service-report date filter.
              </p>
            </>
          )}
        </Panel>
        <Panel
          title="Equipment registry"
          description="Warranty dates do not confirm claim coverage."
        >
          {assets.isPending ? (
            <Loading />
          ) : assets.isError ? (
            <ErrorState
              error={assets.error}
              retry={() => void assets.refetch()}
            />
          ) : (
            <>
              <Figures
                rows={[
                  ["Registered assets", assets.data.registeredAssets],
                  ["Active equipment", assets.data.activeAssets],
                  ["Inactive equipment", assets.data.inactiveAssets],
                  ["Retired equipment", assets.data.retiredAssets],
                  [
                    "Warranties expiring within 90 days",
                    assets.data.warrantyExpiring90Days,
                  ],
                  ["Customers with equipment", assets.data.customersWithAssets],
                  [
                    "Explicitly linked work orders",
                    assets.data.linkedWorkOrders,
                  ],
                  [
                    "Versions awaiting source evidence",
                    assets.data.pendingAssetVersions,
                  ],
                ]}
              />
              <p className="customer-note">
                Refreshed:{" "}
                {assets.data.refreshedAtUtc
                  ? dateTime(assets.data.refreshedAtUtc)
                  : "Awaiting asset events"}
                . Customer-only orders are excluded from equipment
                service-history counts.
              </p>
            </>
          )}
        </Panel>
      </div>
      <p className="customer-note">
        Counts may lag operational changes. Unlinked legacy orders retain
        unresolved references.
      </p>
    </>
  );
}
