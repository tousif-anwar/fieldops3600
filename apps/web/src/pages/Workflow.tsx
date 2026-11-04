import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Button,
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
  CheckCheck,
  Clock3,
  HelpCircle,
  History,
  LockKeyhole,
  Pause,
  Play,
  Save,
  ShieldCheck,
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
import { RiskAssessment } from "../components/RiskAssessment";
import { completedStageCount } from "../workflow";

export function visibleFields(
  fields: FormField[],
  answers: Record<string, string>,
) {
  return fields.filter(
    (f) => !f.conditionField || answers[f.conditionField] === f.conditionValue,
  );
}
export function MyJobs() {
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
  return (
    <>
      <PageHeader
        eyebrow="TECHNICIAN WORKSPACE"
        title="Good work, one step at a time."
        description="Open an assigned job and follow the eight-stage guided service pipeline."
      />
      {orders.isPending ? (
        <Loading />
      ) : orders.isError ? (
        <ErrorState error={orders.error} retry={() => void orders.refetch()} />
      ) : assigned.length === 0 ? (
        <Panel title="Assigned work">
          <Empty
            title="No assigned jobs yet"
            description="Your confirmed assignments will appear here. Contact dispatch if you are expecting a job."
          />
        </Panel>
      ) : (
        <div className="jobs-grid">
          {assigned.map((w) => {
            const f = workflows.data?.find((f) => f.workOrderId === w.id);
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
                  icon={<ArrowRight size={16} />}
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
      {start.isError && <InlineMessage>{start.error.message}</InlineMessage>}
    </>
  );
}

export function WorkflowPage() {
  const { id } = useParams();
  const auth = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const workflow = useQuery({
    queryKey: ["workflow", id],
    queryFn: () => api<Workflow>(`/api/workflows/${id}`),
    refetchInterval: 20000,
  });
  const template = useQuery({
    queryKey: ["workflow-template"],
    queryFn: () => api<Template>("/api/workflows/templates/default"),
    staleTime: 300000,
  });
  const [selectedStage, setSelectedStage] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(Date.now());
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
  const draftKey = `fieldops:draft:${auth.user?.profile.sub}:${id}:${activeIndex}`;
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    setMessage("");
    if (stage) {
      let stored: Record<string, string> | null = null;
      try {
        const raw = localStorage.getItem(draftKey);
        stored = raw ? JSON.parse(raw) : null;
      } catch {
        /* Invalid local draft is ignored; server history stays authoritative. */
      }
      setAnswers(
        isCurrent ? (stored ?? stage.answers ?? {}) : (stage.answers ?? {}),
      );
      requestKey.current = crypto.randomUUID();
    }
  }, [draftKey, stage?.id, isCurrent]);
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
        next.status === "Completed"
          ? "Service workflow complete. Thank you for a job well done."
          : "Stage submitted. Your next step is ready.",
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
      setAction(null);
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
      <button className="back-link" onClick={() => navigate("/my-jobs")}>
        <ArrowLeft size={15} />
        My workflow
      </button>
      <PageHeader
        eyebrow={`SERVICE WORKFLOW · TEMPLATE V${f.templateVersion}`}
        title={
          f.status === "Completed"
            ? "A job well done."
            : (stage?.name ?? "Guided service")
        }
        description={`Work order ${f.workOrderId.slice(0, 8)} · ${f.technicianId} · Version ${f.version}`}
        actions={
          auth.can("Supervisor", "OperationsManager") && (
            <Button
              icon={<History size={17} />}
              onClick={() => navigate(`/replay?workOrderId=${f.workOrderId}`)}
            >
              View operational replay
            </Button>
          )
        }
      />
      <div className="workflow-layout">
        <aside className="workflow-stepper">
          <div className="stepper-heading">
            <Wrench size={18} />
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
                      {completed ? <Check size={15} /> : s.index + 1}
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
                    {!available && <LockKeyhole size={13} />}
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="stepper-note">
            <ShieldCheck size={16} />
            <span>Your progress is recorded securely at every step.</span>
          </div>
        </aside>
        <div className="workflow-main">
          {message && <InlineMessage success>{message}</InlineMessage>}
          {f.status === "Completed" && (
            <div className="completed-banner">
              <span>
                <CheckCheck size={28} />
              </span>
              <div>
                <h2>Service complete</h2>
                <p>
                  Every stage is preserved as read-only history. Select a step
                  to review the recorded answers.
                </p>
              </div>
            </div>
          )}
          {stage && (
            <Panel
              title={`${activeIndex + 1}. ${stage.name}`}
              description={
                !isCurrent
                  ? "Recorded stage history. Completed answers cannot be edited."
                  : "Choose the answers that accurately describe the service. Request assistance when you need another path."
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
                    <Clock3 size={24} />
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
                        The server enforces the 30-minute stage SLA.
                      </>
                    )}
                  </p>
                </div>
              )}
              <form
                className="form-body"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit.mutate();
                }}
              >
                {visibleFields(fields, answers).map((field) => (
                  <Field
                    key={field.key}
                    label={field.label}
                    required={field.required && editable}
                  >
                    <Select
                      value={answers[field.key] ?? ""}
                      required={field.required && editable}
                      disabled={!editable}
                      onChange={(e) => {
                        setAnswers((old) => ({
                          ...old,
                          [field.key]: e.target.value,
                        }));
                        setMessage("");
                      }}
                    >
                      <option value="">Select an answer</option>
                      {field.options.map((option) => (
                        <option key={option}>{option}</option>
                      ))}
                    </Select>
                  </Field>
                ))}
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
                      <HelpCircle size={19} />
                      <span>
                        No accurate option or need a hand?
                        <br />
                        <button
                          type="button"
                          onClick={() => {
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
                        icon={<Save size={16} />}
                        onClick={saveDraft}
                      >
                        Save draft
                      </Button>
                      <Button
                        type="submit"
                        appearance="primary"
                        icon={<ArrowRight size={17} />}
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
                    <LockKeyhole size={15} />
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
              description="Every intervention requires a reason and is included in the audit history."
            >
              <div className="supervisor-controls">
                <Button
                  icon={
                    stage?.pausedAtUtc ? (
                      <Play size={16} />
                    ) : (
                      <Pause size={16} />
                    )
                  }
                  onClick={() => {
                    setAction(stage?.pausedAtUtc ? "resume" : "pause");
                    setReason("");
                  }}
                >
                  {stage?.pausedAtUtc ? "Resume stage" : "Approve pause"}
                </Button>
                <Button
                  onClick={() => {
                    setAction("override");
                    setReason("");
                  }}
                >
                  Override stage
                </Button>
              </div>
            </Panel>
          )}
          {isCurrent &&
            stage &&
            auth.can("Supervisor", "OperationsManager") && (
              <RiskAssessment key={stage.id} stage={stage} workflow={f} />
            )}
        </div>
      </div>
      {action && (
        <Dialog
          open
          onOpenChange={(_, data) => {
            if (!data.open) setAction(null);
          }}
        >
          <DialogSurface className="modal" aria-labelledby="action-title">
            <span className="eyebrow">AUDITED WORKFLOW ACTION</span>
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
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Describe why this action is needed"
              />
            </Field>
            {action === "override" && (
              <Field label="Target stage">
                <Select
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
              <Button onClick={() => setAction(null)}>Cancel</Button>
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
      )}
    </>
  );
}
