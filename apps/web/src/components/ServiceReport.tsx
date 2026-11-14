import { useQuery } from "@tanstack/react-query";
import { Button, Dialog, DialogSurface } from "@fluentui/react-components";
import { api } from "../api";
import { dateTime } from "../format";
import { ErrorState, Loading, Status } from "./common";

interface Report {
  workOrderId: string;
  workflowId: string;
  templateVersion: number;
  status: string;
  startedAtUtc: string;
  completedAtUtc: string;
  outcome?: string | null;
  equipmentStatus?: string | null;
  followUpRequired?: boolean | string | null;
  sections: {
    stage: number;
    name: string;
    status: string;
    completedAtUtc?: string;
    responses: { label: string; value: string }[];
  }[];
}

export function ServiceReport({
  workOrderId,
  onClose,
}: {
  workOrderId: string;
  onClose: () => void;
}) {
  const report = useQuery({
    queryKey: ["service-report", workOrderId],
    queryFn: () =>
      api<Report>(
        `/api/workflows/service-report/${encodeURIComponent(workOrderId)}`,
      ),
  });
  return (
    <Dialog
      open
      onOpenChange={(_, data) => {
        if (!data.open) onClose();
      }}
    >
      <DialogSurface
        className="modal service-report"
        aria-labelledby="service-report-title"
      >
        <span className="eyebrow">FIELDOPS 360 · STORED SERVICE RECORD</span>
        <h2 id="service-report-title">Service report</h2>
        {report.isPending ? (
          <Loading />
        ) : report.isError ? (
          <ErrorState
            error={report.error}
            retry={() => void report.refetch()}
          />
        ) : (
          report.data && (
            <>
              <p>
                Completed {dateTime(report.data.completedAtUtc)} · Template v
                {report.data.templateVersion}
              </p>
              <Status value={report.data.status} />
              {report.data.outcome && (
                <p>
                  <strong>Outcome:</strong> {report.data.outcome}
                </p>
              )}
              {report.data.equipmentStatus && (
                <p>
                  <strong>Equipment condition:</strong>{" "}
                  {report.data.equipmentStatus}
                </p>
              )}
              {report.data.followUpRequired != null && (
                <p>
                  <strong>Follow-up:</strong>{" "}
                  {String(report.data.followUpRequired)}
                </p>
              )}
              {report.data.sections.map((section) => (
                <section key={section.stage} className="service-report-section">
                  <div className="portal-record-heading">
                    <h3>{section.name}</h3>
                    <Status value={section.status} />
                  </div>
                  {section.completedAtUtc && (
                    <small>{dateTime(section.completedAtUtc)}</small>
                  )}
                  <dl>
                    {section.responses.map((response) => (
                      <div key={response.label}>
                        <dt>{response.label}</dt>
                        <dd>{response.value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </>
          )
        )}
        <div className="form-actions">
          <Button appearance="primary" onClick={onClose}>
            Close report
          </Button>
        </div>
      </DialogSurface>
    </Dialog>
  );
}
