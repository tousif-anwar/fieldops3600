import { Button } from "@fluentui/react-components";
import {
  ExternalLink,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { PageHeader, Panel } from "../components/common";

export function Administration() {
  const authority =
    import.meta.env.VITE_AUTHORITY ?? "http://localhost:8080/realms/fieldops";
  const identityOrigin = new URL(authority).origin;
  return (
    <>
      <PageHeader
        eyebrow="ADMINISTRATION"
        title="A secure foundation for your team."
        description="Identity, permissions, and versioned operating standards."
      />
      <div className="admin-grid">
        <Panel
          title="Identity & access"
          description="Users and realm roles are managed by the identity provider."
        >
          <div className="admin-card-body">
            <span className="quick-icon">
              <Users size={24} />
            </span>
            <p>
              Manage user access, required actions, credential policies, and
              role assignments in the Keycloak administration console. The
              operations application never stores passwords.
            </p>
            <Button
              as="a"
              href={`${identityOrigin}/admin/`}
              target="_blank"
              rel="noreferrer"
              appearance="primary"
              icon={<ExternalLink size={16} />}
              iconPosition="after"
            >
              Open identity administration
            </Button>
          </div>
        </Panel>
        <Panel
          title="Workflow configuration"
          description="Configuration changes require review and a new template version."
        >
          <div className="admin-card-body">
            <span className="quick-icon green">
              <SlidersHorizontal size={24} />
            </span>
            <p>
              The eight-stage HVAC template is versioned on the backend.
              Existing workflow instances retain their recorded version. SLA
              thresholds use server time and persistent deadlines.
            </p>
            <dl className="detail-list">
              <div>
                <dt>Default stage budget</dt>
                <dd>30 minutes</dd>
              </div>
              <div>
                <dt>Warning / critical / breach</dt>
                <dd>20 / 25 / 30 minutes</dd>
              </div>
              <div>
                <dt>Supervisor actions</dt>
                <dd>Authorized and audited</dd>
              </div>
            </dl>
          </div>
        </Panel>
      </div>
      <div className="metric-definitions">
        <ShieldCheck size={20} />
        <div>
          <strong>Permissions follow the resource</strong>
          <p>
            Role-aware navigation helps users find their work. Backend policies
            independently enforce role, technician assignment, and team
            ownership on every protected request.
          </p>
        </div>
      </div>
    </>
  );
}
