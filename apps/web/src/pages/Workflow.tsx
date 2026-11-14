import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Button,
  useRestoreFocusTarget,
  Dialog,
  DialogSurface,
  Field,
  Input,
  Select,
} from "@fluentui/react-components";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock3,
  HelpCircle,
  History,
  LockKeyhole,
  Pause,
  Play,
  Save,
  Wrench,
} from "lucide-react";
import { api, post } from "../api";
import { useAuth } from "../auth";
import { countdown, dateTime } from "../format";
import {
  Empty,
  ErrorState,
  InlineMessage,
  Loading,
  PageHeader,
  Panel,
  Status,
} from "../components/common";
import type { FormField, Template, WorkOrder, Workflow } from "../types";
import { ListPagination, pageSlice } from "../components/ListPagination";
import { completedStageCount } from "../workflow";
import { answerError, WorkflowAnswer } from "../components/WorkflowAnswer";
import { ServiceReport } from "../components/ServiceReport";

export function visibleFields(
  fields: FormField[],
  answers: Record<string, string>,
) {
  return fields.filter(
    (f) => !f.conditionField || answers[f.conditionField] === f.conditionValue,
  );
}
export function MyJobs() {
  const [page, setPage] = useState(1);
  const auth = useAuth();
  const navigate = useNavigate();
  const orders = useQuery({
    queryKey: ["work-orders"],
    queryFn: () => api<WorkOrder[]>("/api/work-orders"),
  });
  const workflows = useQuery({
    queryKey: ["workflows"],
    queryFn: () => api<Workflow[]>("/api/workflows"),
  });
  const start = useMutation({
    mutationFn: (id: string) =>
      post<Workflow>("/api/workflows", { workOrderId: id }),
    onSuccess: (f) => navigate(`/workflow/${f.id}`),
  });
  const assigned = (orders.data ?? []).filter(
    (w) =>
      w.technicianId &&
      (auth.can("Supervisor", "Dispatcher", "OperationsManager") ||
        w.technicianId === auth.user?.profile.sub),
  );
  const rows = pageSlice(assigned, page);
  const flowByOrder = new Map(
    (workflows.data ?? []).map((flow) => [flow.workOrderId, flow]),
  );
  return (
    <>
      <PageHeader
        title={
          auth.can("Supervisor", "OperationsManager")
            ? "Workflow review"
            : "My work"
        }
      />
      {orders.isPending || workflows.isPending ? (
        <Loading />
      ) : orders.isError ? (
        <ErrorState error={orders.error} retry={() => void orders.refetch()} />
      ) : workflows.isError ? (
        <ErrorState
          error={workflows.error}
          retry={() => void workflows.refetch()}
        />
      ) : assigned.length === 0 ? (
        <Empty
          title="No assigned jobs"
          description="Contact dispatch if you are expecting an assignment."
        />
      ) : (
        <div className="jobs-grid">
          {rows.items.map((w) => {
            const f = flowByOrder.get(w.id);
            const completed = completedStageCount(f);
            return (
              <article
                className="job-card"
                key={w.id}
                data-work-order-id={w.id}
              >
                <div className="job-card-top">
                  <span className="order-number">{w.number}</span>
                  <Status value={w.priority} />
                </div>
                <h2>{w.title}</h2>
                <p>{w.customerName}</p>
                <p className="muted">{w.siteAddress}</p>
                <div
                  className="job-progress"
                  role="progressbar"
                  aria-label={`${w.number} workflow completion`}
                  aria-valuemin={0}
                  aria-valuemax={8}
                  aria-valuenow={completed}
                  aria-valuetext={`${completed} of 8 stages complete`}
                >
                  <div
                    style={{
                      width: `${(completed / 8) * 100}%`,
                    }}
                  />
                </div>
                <div className="job-card-stage">
                  <span>
                    {f
                      ? f.status === "Completed"
                        ? "All stages complete"
                        : f.stages.find((s) => s.index === f.currentStageIndex)
                            ?.name
                      : "Ready to begin"}
                  </span>
                  <small>{completed}/8 stages</small>
                </div>
                <Button
                  appearance="primary"
                  icon={<ArrowRight aria-hidden="true" size={16} />}
                  iconPosition="after"
                  disabled={start.isPending}
                  onClick={() =>
                    f ? navigate(`/workflow/${f.id}`) : start.mutate(w.id)
                  }
                >
                  {f?.status === "Completed"
                    ? "Review service"
                    : f
                      ? "Continue service"
                      : "Start service workflow"}
                </Button>
              </article>
            );
          })}
        </div>
      )}
      {orders.isSuccess && workflows.isSuccess && (
        <ListPagination
          page={rows.page}
          total={assigned.length}
          onChange={setPage}
          label="Assigned jobs"
        />
      )}
      {start.isError && <InlineMessage>{start.error.message}</InlineMessage>}
    </>
  );
}

export function WorkflowPage() {
  const [interventionOpen, setInterventionOpen] = useState(false);
  const restoreFocusTarget = useRestoreFocusTarget();
  const { id } = useParams();
  const auth = useAuth();
  const qc = useQueryClient();
  const workflow = useQuery({
    queryKey: ["workflow", id],
    queryFn: () => api<Workflow>(`/api/workflows/${id}`),
    refetchInterval: 20000,
  });
  const template = useQuery({
    queryKey: ["workflow-template", workflow.data?.templateVersion],
    queryFn: () =>
      api<Template>(
        `/api/workflows/templates/${workflow.data!.templateVersion}`,
      ),
    enabled: !!workflow.data,
    staleTime: 300000,
  });
  const order = useQuery({
    queryKey: ["work-order", workflow.data?.workOrderId],
    queryFn: () =>
      api<WorkOrder>(`/api/work-orders/${workflow.data!.workOrderId}`),
    enabled: !!workflow.data?.workOrderId,
  });
  const [selectedStage, setSelectedStage] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(Date.now());
  const [formError, setFormError] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  const [action, setAction] = useState<
    null | "pause" | "resume" | "assistance" | "override"
  >(null);
  const [reason, setReason] = useState("");
  const [targetStage, setTargetStage] = useState("0");
  const requestKey = useRef(crypto.randomUUID());
  const f = workflow.data;
  const activeIndex = selectedStage ?? f?.currentStageIndex ?? 0;
  const stage = f?.stages.find((s) => s.index === activeIndex);
  const fields =
    template.data?.stages.find((s) => s.index === activeIndex)?.fields ?? [];
  const isCurrent =
    !!f && activeIndex === f.currentStageIndex && f.status !== "Completed";
  const editable = isCurrent && !stage?.pausedAtUtc;
  const stageId = stage?.id;
  const recordedAnswersJson = JSON.stringify(stage?.answers ?? {});
  const draftKey = `fieldops:draft:${auth.user?.profile.sub}:${id}:${activeIndex}`;
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    setMessage("");
    setFormError("");
    if (stageId) {
      let stored: Record<string, string> | null = null;
      try {
        const raw = localStorage.getItem(draftKey);
        stored = raw ? JSON.parse(raw) : null;
      } catch {
        /* Invalid local draft is ignored; server history stays authoritative. */
      }
      const recordedAnswers: Record<string, string> =
        JSON.parse(recordedAnswersJson);
      setAnswers(isCurrent ? (stored ?? recordedAnswers) : recordedAnswers);
      requestKey.current = crypto.randomUUID();
    }
  }, [draftKey, stageId, isCurrent, recordedAnswersJson]);
  const submit = useMutation({
    mutationFn: () =>
      post<Workflow>(`/api/workflows/${id}/submit`, {
        expectedVersion: f!.version,
        idempotencyKey: requestKey.current,
        answers: Object.fromEntries(
          visibleFields(fields, answers).map((field) => [
            field.key,
            answers[field.key],
          ]),
        ),
        clientOccurredAtUtc: new Date().toISOString(),
      }),
    onSuccess: (next) => {
      localStorage.removeItem(draftKey);
      qc.setQueryData(["workflow", id], next);
      void qc.invalidateQueries({ queryKey: ["workflows"] });
      setSelectedStage(null);
      requestKey.current = crypto.randomUUID();
      setMessage(
        next.status === "Completed" ? "Service complete." : "Stage submitted.",
      );
    },
  });
  const intervention = useMutation({
    mutationFn: () =>
      post<Workflow>(`/api/workflows/${id}/${action}`, {
        expectedVersion: f!.version,
        reason,
        targetStageIndex:
          action === "override" ? Number(targetStage) : undefined,
      }),
    onSuccess: (next) => {
      if (next?.id) qc.setQueryData(["workflow", id], next);
      else void workflow.refetch();
      void qc.invalidateQueries({ queryKey: ["workflows"] });
      setMessage(
        action === "assistance"
          ? "Your assistance request has been recorded for the supervisor."
          : "Supervisor action recorded in the operational history.",
      );
      setInterventionOpen(false);
      setReason("");
    },
  });
  const saveDraft = () => {
    try {
      localStorage.setItem(draftKey, JSON.stringify(answers));
      setMessage(
        "Draft saved on this device. Submit when you are ready and online.",
      );
    } catch {
      setMessage(
        "This browser could not save the draft. Keep this page open and reconnect before submitting.",
      );
    }
  };
  if (workflow.isPending || template.isPending)
    return <Loading label="Loading your guided workflow…" />;
  if (workflow.isError)
    return (
      <ErrorState
        error={workflow.error}
        retry={() => void workflow.refetch()}
      />
    );
  if (template.isError)
    return (
      <ErrorState
        error={template.error}
        retry={() => void template.refetch()}
      />
    );
  if (!f) return null;
  return (
    <>
      <Link to={"/my-jobs"} className="back-link">
        <ArrowLeft aria-hidden="true" size={15} />
        My workflow
      </Link>
      <PageHeader
        title={
          f.status === "Completed" ? "Service complete" : "Service workflow"
        }
        description={`Work order ${f.workOrderId.slice(0, 8)} · ${f.technicianId} · Version ${f.version}`}
        actions={
          <>
            {f.status === "Completed" && (
              <Button
                {...restoreFocusTarget}
                onClick={() => setReportOpen(true)}
              >
                View service report
              </Button>
            )}
            {auth.can("Supervisor", "OperationsManager") && (
              <Link
                to={`/replay?workOrderId=${f.workOrderId}`}
                className="button-link"
              >
                <History aria-hidden="true" size={17} />
                View operational replay
              </Link>
            )}
          </>
        }
      />
      <div className="workflow-layout">
        <aside className="workflow-stepper">
          <div className="stepper-heading">
            <Wrench aria-hidden="true" size={18} />
            <strong>Service pipeline</strong>
            <small>{completedStageCount(f)} of 8 complete</small>
          </div>
          <ol>
            {f.stages.map((s) => {
              const completed = ["Completed", "Overridden"].includes(s.status);
              const available = completed || s.index === f.currentStageIndex;
              return (
                <li
                  key={s.id}
                  className={`${completed ? "complete" : ""} ${s.index === activeIndex ? "current" : ""}`}
                >
                  <button
                    disabled={!available}
                    onClick={() => setSelectedStage(s.index)}
                    aria-current={s.index === activeIndex ? "step" : undefined}
                  >
                    <span className="step-number">
                      {completed ? (
                        <Check aria-hidden="true" size={15} />
                      ) : (
                        s.index + 1
                      )}
                    </span>
                    <span>
                      <strong>{s.name}</strong>
                      <small>
                        {completed
                          ? `${s.status} · read only`
                          : s.index === f.currentStageIndex
                            ? "Current stage"
                            : "Coming up"}
                      </small>
                    </span>
                    {!available && <LockKeyhole aria-hidden="true" size={13} />}
                  </button>
                </li>
              );
            })}
          </ol>
        </aside>
        <div className="workflow-main">
          <Panel
            title="Job briefing"
            description={
              order.data
                ? `${order.data.number} · ${order.data.customerName} · ${order.data.siteAddress}`
                : "Customer-reported service details"
            }
          >
            {order.isPending ? (
              <Loading label="Loading job briefing…" />
            ) : order.isError ? (
              <ErrorState
                error={order.error}
                retry={() => void order.refetch()}
              />
            ) : (
              order.data && (
                <div className="form-body">
                  <strong>Reported problem</strong>
                  <p className="portal-notes">
                    {order.data.reportedProblem?.trim()
                      ? order.data.reportedProblem
                      : order.data.title}
                  </p>
                </div>
              )
            )}
          </Panel>
          {message && <InlineMessage success>{message}</InlineMessage>}
          {stage && (
            <Panel
              title={`${activeIndex + 1}. ${stage.name}`}
              description={
                !isCurrent
                  ? "Recorded answers are read-only."
                  : "Record the service result. Request assistance if you cannot proceed."
              }
              action={
                <Status
                  value={
                    stage.pausedAtUtc
                      ? "Paused"
                      : (stage.slaStatus ?? stage.status)
                  }
                />
              }
            >
              {isCurrent && (
                <div
                  className={`countdown-bar ${/Breach|Critical/.test(stage.slaStatus) ? "countdown-critical" : ""}`}
                >
                  <span className="countdown-icon">
                    <Clock3 aria-hidden="true" size={24} />
                  </span>
                  <div>
                    <small>
                      {stage.pausedAtUtc
                        ? "APPROVED PAUSE ACTIVE"
                        : "STAGE TIME REMAINING"}
                    </small>
                    <strong>
                      {countdown(stage.deadlineUtc, now, stage.pausedAtUtc)}
                    </strong>
                  </div>
                  <p>
                    {stage.pausedAtUtc ? (
                      "The timer resumes when a supervisor approves."
                    ) : (
                      <>
                        Deadline {dateTime(stage.deadlineUtc)}
                        <br />
                        The server records and enforces this stage deadline.
                      </>
                    )}
                  </p>
                </div>
              )}
              <form
                className="form-body"
                onSubmit={(e) => {
                  e.preventDefault();
                  const error = visibleFields(fields, answers)
                    .map((field) => answerError(field, answers[field.key]))
                    .find(Boolean);
                  if (error) {
                    setFormError(error);
                    return;
                  }
                  setFormError("");
                  submit.mutate();
                }}
              >
                {visibleFields(fields, answers).map((field) => (
                  <WorkflowAnswer
                    key={field.key}
                    field={field}
                    value={answers[field.key] ?? ""}
                    editable={editable && !submit.isPending}
                    onChange={(value) => {
                      setAnswers((old) => ({
                        ...old,
                        [field.key]: value,
                      }));
                      setMessage("");
                      setFormError("");
                    }}
                  />
                ))}
                {formError && <InlineMessage>{formError}</InlineMessage>}
                {!fields.length && (
                  <InlineMessage>
                    Form definition is unavailable for this template version.
                    Contact your administrator before continuing.
                  </InlineMessage>
                )}
                {submit.isError && (
                  <>
                    <InlineMessage>{submit.error.message}</InlineMessage>
                    <Button onClick={() => void workflow.refetch()}>
                      Reload current server state
                    </Button>
                  </>
                )}
                {editable && (
                  <>
                    <div className="workflow-help">
                      <HelpCircle aria-hidden="true" size={19} />
                      <span>
                        Need assistance?
                        <br />
                        <button
                          {...restoreFocusTarget}
                          type="button"
                          onClick={() => {
                            setInterventionOpen(true);
                            setAction("assistance");
                            setReason("");
                          }}
                        >
                          Request supervisor assistance
                        </button>
                      </span>
                    </div>
                    <div className="form-actions">
                      <Button
                        type="button"
                        icon={<Save aria-hidden="true" size={16} />}
                        onClick={saveDraft}
                      >
                        Save draft
                      </Button>
                      <Button
                        type="submit"
                        appearance="primary"
                        icon={<ArrowRight aria-hidden="true" size={17} />}
                        iconPosition="after"
                        disabled={
                          submit.isPending ||
                          !fields.length ||
                          !navigator.onLine
                        }
                      >
                        {submit.isPending
                          ? "Submitting…"
                          : activeIndex === 7
                            ? "Complete service"
                            : "Submit & continue"}
                      </Button>
                    </div>
                  </>
                )}
                {!isCurrent && (
                  <div className="history-note">
                    <LockKeyhole aria-hidden="true" size={15} />
                    Completed {dateTime(stage.completedAtUtc)} · Preserved as
                    recorded history
                  </div>
                )}
              </form>
            </Panel>
          )}
          {isCurrent && auth.can("Supervisor", "OperationsManager") && (
            <Panel
              title="Supervisor controls"
              description="A reason is required for every intervention."
            >
              <div className="supervisor-controls">
                <Button
                  {...restoreFocusTarget}
                  icon={
                    stage?.pausedAtUtc ? (
                      <Play aria-hidden="true" size={16} />
                    ) : (
                      <Pause aria-hidden="true" size={16} />
                    )
                  }
                  onClick={() => {
                    setInterventionOpen(true);
                    setAction(stage?.pausedAtUtc ? "resume" : "pause");
                    setReason("");
                  }}
                >
                  {stage?.pausedAtUtc ? "Resume stage" : "Approve pause"}
                </Button>
                <Button
                  {...restoreFocusTarget}
                  onClick={() => {
                    setInterventionOpen(true);
                    setAction("override");
                    setReason("");
                  }}
                >
                  Override stage
                </Button>
              </div>
            </Panel>
          )}
        </div>
      </div>
      <ServiceReport
        workOrderId={f.workOrderId}
        open={reportOpen}
        onClose={() => setReportOpen(false)}
      />
      <Dialog
        open={interventionOpen}
        onOpenChange={(_, data) => {
          if (!data.open) setInterventionOpen(false);
        }}
      >
        <DialogSurface className="modal" aria-labelledby="action-title">
          <h2 id="action-title">
            {action === "assistance"
              ? "Request assistance"
              : action === "pause"
                ? "Approve a stage pause"
                : action === "resume"
                  ? "Resume the stage"
                  : "Override the current stage"}
          </h2>
          <p>
            {action === "assistance"
              ? "Tell your supervisor what support you need. Keep the current answers accurate."
              : "This changes the authoritative workflow state and will be visible in operational replay."}
          </p>
          <Field label="Reason" required>
            <Input
              name="reason"
              autoComplete="off"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Describe why this action is needed"
            />
          </Field>
          {action === "override" && (
            <Field label="Target stage">
              <Select
                name="target-stage"
                value={targetStage}
                onChange={(e) => setTargetStage(e.target.value)}
              >
                {f.stages.map((s) => (
                  <option key={s.id} value={s.index}>
                    {s.index + 1}. {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {intervention.isError && (
            <InlineMessage>{intervention.error.message}</InlineMessage>
          )}
          <div className="form-actions">
            <Button onClick={() => setInterventionOpen(false)}>Cancel</Button>
            <Button
              appearance="primary"
              disabled={reason.trim().length < 5 || intervention.isPending}
              onClick={() => intervention.mutate()}
            >
              {intervention.isPending ? "Recording…" : "Confirm action"}
            </Button>
          </div>
        </DialogSurface>
      </Dialog>
    </>
  );
}
