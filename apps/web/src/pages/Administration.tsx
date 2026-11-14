import { Button } from "@fluentui/react-components";
import { ExternalLink } from "lucide-react";
import { PageHeader, Panel } from "../components/common";

export function Administration() {
  const authority =
    import.meta.env.VITE_AUTHORITY ?? "http://localhost:8080/realms/fieldops";
  const identityOrigin = new URL(authority).origin;
  return (
    <>
      <PageHeader title="Administration" />
      <div className="admin-grid">
        <Panel title="Identity & access">
          <div className="admin-card-body">
            <p>Manage users, roles, and credentials in Keycloak.</p>
            <Button
              as="a"
              href={`${identityOrigin}/admin/`}
              target="_blank"
              rel="noreferrer"
              appearance="primary"
              icon={<ExternalLink size={16} aria-hidden="true" />}
              iconPosition="after"
            >
              Open identity administration
            </Button>
          </div>
        </Panel>
        <Panel title="Workflow configuration">
          <p className="customer-note">
            Changes require review and a new template version. Existing
            workflows retain their recorded version; SLA deadlines use server
            time.
          </p>
        </Panel>
      </div>
    </>
  );
}
