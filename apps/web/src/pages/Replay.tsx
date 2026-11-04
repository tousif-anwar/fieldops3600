import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Button, Field, Input, Select } from "@fluentui/react-components";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Braces,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Filter,
  History,
  Pause,
  Play,
  RotateCcw,
  Search,
  ShieldCheck,
  SkipBack,
  StepForward,
  TriangleAlert,
} from "lucide-react";
import { api, download } from "../api";
import { dateTime, humanize } from "../format";
import {
  Empty,
  ErrorState,
  InlineMessage,
  Loading,
  PageHeader,
  Panel,
  Status,
} from "../components/common";
import {
  eventTone,
  filterEvents,
  isLate,
  reconstruct,
  type ReplayFilters,
} from "../replay";
import type { Replay, ReplayEvent, WorkOrder } from "../types";
import { TraceEvidence } from "../components/TraceEvidence";
import { DeliveryEvidence } from "../components/DeliveryEvidence";

const initialFilters: ReplayFilters = {
  type: "",
  service: "",
  actor: "",
  from: "",
  to: "",
  correlation: "",
  trace: "",
};

export function ReplayPage() {
  const [params, setParams] = useSearchParams();
  const [draftId, setDraftId] = useState(params.get("workOrderId") ?? "");
  const workOrderId = params.get("workOrderId") ?? "";
  const [filters, setFilters] = useState(initialFilters);
  const [showFilters, setShowFilters] = useState(false);
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState("1");
  const [jumpTime, setJumpTime] = useState("");
  const [technical, setTechnical] = useState(false);
  const [exportError, setExportError] = useState("");
  const orders = useQuery({
    queryKey: ["work-orders"],
    queryFn: () => api<WorkOrder[]>("/api/work-orders"),
  });
  const replay = useQuery({
    queryKey: ["replay", workOrderId],
    queryFn: () =>
      api<Replay>(`/api/replay/${encodeURIComponent(workOrderId)}`),
    enabled: !!workOrderId,
  });
  const events = replay.data?.events ?? [];
  const filtered = useMemo(
    () => filterEvents(events, filters),
    [events, filters],
  );
  const selected = events[index];
  const state = useMemo(() => reconstruct(events, index), [events, index]);
  const order = orders.data?.find((w) => w.id === workOrderId);
  useEffect(() => {
    setIndex(events.length ? 0 : -1);
    setPlaying(false);
    setFilters(initialFilters);
  }, [workOrderId, replay.dataUpdatedAt]);
  useEffect(() => {
    if (!playing) return;
    const handle = window.setInterval(
      () =>
        setIndex((current) => {
          if (current >= events.length - 1) {
            setPlaying(false);
            return current;
          }
          return current + 1;
        }),
      1600 / Number(speed),
    );
    return () => window.clearInterval(handle);
  }, [playing, speed, events.length]);
  const jump = (pattern: RegExp) => {
    const target = events.findIndex((e) => pattern.test(e.eventType));
    if (target >= 0) {
      setIndex(target);
      setPlaying(false);
    }
  };
  const changeFilter = (key: keyof ReplayFilters, value: string) =>
    setFilters((old) => ({ ...old, [key]: value }));
  const exportFile = async (extension: "csv" | "pdf") => {
    setExportError("");
    try {
      await download(
        `/api/replay/${encodeURIComponent(workOrderId)}/export.${extension}`,
        `fieldops-incident-${order?.number ?? workOrderId}.${extension}`,
      );
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Export failed.");
    }
  };
  return (
    <>
      <PageHeader
        eyebrow="INVESTIGATION WORKSPACE"
        title="Every event tells part of the story."
        description="Reconstruct recorded history, understand an incident, and follow the evidence across services."
        actions={
          <span className="read-only-tag">
            <ShieldCheck size={15} />
            Read-only historical playback
          </span>
        }
      />
      <div className="replay-search">
        <span className="replay-search-icon">
          <History size={25} />
        </span>
        <div>
          <strong>Find the operational story</strong>
          <small>
            Choose a work order to inspect its complete event history.
          </small>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (draftId.trim()) setParams({ workOrderId: draftId.trim() });
          }}
        >
          <Select
            aria-label="Select work order for investigation"
            value={draftId}
            onChange={(e) => setDraftId(e.target.value)}
          >
            <option value="">Select a work order</option>
            {orders.data?.map((w) => (
              <option key={w.id} value={w.id}>
                {w.number} — {w.title}
              </option>
            ))}
          </Select>
          <Button
            appearance="primary"
            type="submit"
            disabled={!draftId}
            icon={<Search size={16} />}
          >
            Investigate
          </Button>
        </form>
      </div>
      {!workOrderId ? (
        <Panel title="A complete history. A clearer answer.">
          <div className="replay-intro">
            <div className="replay-intro-line">
              <span>Created</span>
              <i />
              <span>Assigned</span>
              <i />
              <span>Service</span>
              <i />
              <span>Intervention</span>
              <i />
              <span>Completed</span>
            </div>
            <p>
              Select a work order to see business events, SLA milestones,
              delivery attempts, and supervisor actions in one connected
              timeline.
            </p>
            <div className="replay-principles">
              <span>
                <Clock3 size={19} />
                <strong>Time with context</strong>
                <small>
                  Occurrence, arrival, and processing stay distinct.
                </small>
              </span>
              <span>
                <ShieldCheck size={19} />
                <strong>Evidence preserved</strong>
                <small>
                  Playback reads history without changing operations.
                </small>
              </span>
              <span>
                <Braces size={19} />
                <strong>Trace the details</strong>
                <small>Correlate events with service and trace metadata.</small>
              </span>
            </div>
          </div>
        </Panel>
      ) : replay.isPending ? (
        <Loading label="Reconstructing the recorded history…" />
      ) : replay.isError ? (
        <ErrorState error={replay.error} retry={() => void replay.refetch()} />
      ) : (
        <>
          <div className="incident-summary">
            <div>
              <span className="eyebrow">
                {order?.number ?? workOrderId.slice(0, 8)}
              </span>
              <h2>{order?.title ?? "Work order investigation"}</h2>
              <p>
                {events.length} recorded events <span>·</span>{" "}
                {new Set(events.map((e) => e.sourceService)).size} services{" "}
                <span>·</span> {dateTime(replay.data.summary.incidentStartUtc)}
              </p>
            </div>
            <div className="incident-stats">
              <span>
                <strong>{replay.data.summary.breachCount}</strong>SLA breaches
              </span>
              <span>
                <strong>{replay.data.summary.interventionCount}</strong>
                Interventions
              </span>
              <span>
                <Status value={replay.data.summary.outcome} />
              </span>
            </div>
            <div className="export-actions">
              <Button
                icon={<ArrowDownToLine size={15} />}
                onClick={() => void exportFile("csv")}
              >
                CSV
              </Button>
              <Button
                icon={<ArrowDownToLine size={15} />}
                onClick={() => void exportFile("pdf")}
              >
                Incident PDF
              </Button>
            </div>
          </div>
          {exportError && <InlineMessage>{exportError}</InlineMessage>}
          {!events.length ? (
            <Panel title="Operational history">
              <Empty
                title="No events have arrived yet"
                description="The transactional outbox publishes events asynchronously. Refresh after the replay consumer has processed them."
                action={
                  <Button onClick={() => void replay.refetch()}>
                    Refresh history
                  </Button>
                }
              />
            </Panel>
          ) : (
            <>
              <section
                className="playback-panel"
                aria-label="Historical playback controls"
              >
                <div className="playback-controls">
                  <Button
                    appearance="subtle"
                    icon={<SkipBack size={17} />}
                    aria-label="Jump to first event"
                    onClick={() => {
                      setIndex(0);
                      setPlaying(false);
                    }}
                  />
                  <Button
                    appearance="subtle"
                    icon={<ChevronLeft size={18} />}
                    aria-label="Previous event"
                    disabled={index <= 0}
                    onClick={() => {
                      setIndex((i) => i - 1);
                      setPlaying(false);
                    }}
                  />
                  <Button
                    appearance="primary"
                    icon={playing ? <Pause size={17} /> : <Play size={17} />}
                    onClick={() => {
                      if (index >= events.length - 1) setIndex(0);
                      setPlaying((p) => !p);
                    }}
                  >
                    {playing ? "Pause" : "Play"}
                  </Button>
                  <Button
                    appearance="subtle"
                    icon={<ChevronRight size={18} />}
                    aria-label="Next event"
                    disabled={index >= events.length - 1}
                    onClick={() => {
                      setIndex((i) => i + 1);
                      setPlaying(false);
                    }}
                  />
                  <Select
                    aria-label="Playback speed"
                    value={speed}
                    onChange={(e) => setSpeed(e.target.value)}
                  >
                    <option value="0.5">0.5×</option>
                    <option value="1">1×</option>
                    <option value="2">2×</option>
                    <option value="4">4×</option>
                  </Select>
                  <span className="playback-count">
                    Event <strong>{index + 1}</strong> of {events.length}
                  </span>
                  <div className="playback-jumps">
                    <Button
                      size="small"
                      icon={<TriangleAlert size={14} />}
                      disabled={!events.some((e) => /Breach/.test(e.eventType))}
                      onClick={() => jump(/Breach/)}
                    >
                      First breach
                    </Button>
                    <Button
                      size="small"
                      disabled={
                        !events.some((e) =>
                          /Pause|Override|Resume/.test(e.eventType),
                        )
                      }
                      onClick={() => jump(/Pause|Override|Resume/)}
                    >
                      First intervention
                    </Button>
                  </div>
                </div>
                <input
                  className="playback-range"
                  type="range"
                  min={0}
                  max={events.length - 1}
                  value={Math.max(0, index)}
                  aria-label="Historical event position"
                  onChange={(e) => {
                    setIndex(Number(e.target.value));
                    setPlaying(false);
                  }}
                />
                <div className="playback-caption">
                  <span>{dateTime(events[0].occurredAtUtc)}</span>
                  <span>One recorded event per step · {speed}× playback</span>
                  <span>{dateTime(events.at(-1)?.occurredAtUtc)}</span>
                </div>
              </section>
              <section
                className="historical-state"
                aria-label="Reconstructed state at selected event"
              >
                <span className="historical-label">
                  <History size={16} />
                  STATE AT THIS MOMENT
                </span>
                <div>
                  <small>Work order</small>
                  <strong>{state.status}</strong>
                </div>
                <div>
                  <small>Current stage</small>
                  <strong>{state.stage}</strong>
                </div>
                <div>
                  <small>Technician</small>
                  <strong>{state.technicianId}</strong>
                </div>
                <div>
                  <small>Stage SLA</small>
                  <Status value={state.paused ? "Paused" : state.sla} />
                </div>
              </section>
              <div className="replay-layout">
                <Panel
                  title="Event timeline"
                  description={`${filtered.length} of ${events.length} events · Authoritative service occurrence time`}
                  action={
                    <Button
                      size="small"
                      icon={<Filter size={15} />}
                      onClick={() => setShowFilters((v) => !v)}
                      aria-expanded={showFilters}
                    >
                      Filters
                    </Button>
                  }
                >
                  {showFilters && (
                    <div className="replay-filters">
                      <Field label="Event type">
                        <Select
                          value={filters.type}
                          onChange={(e) => changeFilter("type", e.target.value)}
                        >
                          <option value="">All event types</option>
                          {[...new Set(events.map((e) => e.eventType))].map(
                            (v) => (
                              <option key={v} value={v}>
                                {humanize(v)}
                              </option>
                            ),
                          )}
                        </Select>
                      </Field>
                      <Field label="Service">
                        <Select
                          value={filters.service}
                          onChange={(e) =>
                            changeFilter("service", e.target.value)
                          }
                        >
                          <option value="">All services</option>
                          {[...new Set(events.map((e) => e.sourceService))].map(
                            (v) => (
                              <option key={v}>{v}</option>
                            ),
                          )}
                        </Select>
                      </Field>
                      <Field label="Actor">
                        <Select
                          value={filters.actor}
                          onChange={(e) =>
                            changeFilter("actor", e.target.value)
                          }
                        >
                          <option value="">All actors</option>
                          {[...new Set(events.map((e) => e.actorId))].map(
                            (v) => (
                              <option key={v}>{v}</option>
                            ),
                          )}
                        </Select>
                      </Field>
                      <Field label="From (local time)">
                        <Input
                          type="datetime-local"
                          value={filters.from}
                          onChange={(e) => changeFilter("from", e.target.value)}
                        />
                      </Field>
                      <Field label="To (local time)">
                        <Input
                          type="datetime-local"
                          value={filters.to}
                          onChange={(e) => changeFilter("to", e.target.value)}
                        />
                      </Field>
                      <Field label="Correlation ID">
                        <Input
                          value={filters.correlation}
                          onChange={(e) =>
                            changeFilter("correlation", e.target.value)
                          }
                          placeholder="Search correlation…"
                        />
                      </Field>
                      <Field label="Trace ID">
                        <Input
                          value={filters.trace}
                          onChange={(e) =>
                            changeFilter("trace", e.target.value)
                          }
                          placeholder="Search trace…"
                        />
                      </Field>
                      <Button
                        appearance="subtle"
                        icon={<RotateCcw size={14} />}
                        onClick={() => setFilters(initialFilters)}
                      >
                        Clear filters
                      </Button>
                    </div>
                  )}
                  <div className="jump-time">
                    <Input
                      aria-label="Jump to timestamp"
                      type="datetime-local"
                      value={jumpTime}
                      onChange={(e) => setJumpTime(e.target.value)}
                    />
                    <Button
                      size="small"
                      disabled={!jumpTime}
                      icon={<StepForward size={14} />}
                      onClick={() => {
                        const target = events.findIndex(
                          (e) =>
                            Date.parse(e.occurredAtUtc) >= Date.parse(jumpTime),
                        );
                        setIndex(target < 0 ? events.length - 1 : target);
                        setPlaying(false);
                      }}
                    >
                      Jump to time
                    </Button>
                  </div>
                  {!filtered.length ? (
                    <Empty
                      title="No events match these filters"
                      description="Clear or adjust the filters to continue investigating."
                    />
                  ) : (
                    <ol className="event-timeline">
                      {filtered.map((e) => {
                        const eventIndex = events.findIndex(
                          (item) => item.eventId === e.eventId,
                        );
                        const current = eventIndex === index;
                        return (
                          <li
                            key={e.eventId}
                            className={`timeline-event ${eventTone(e)} ${current ? "selected" : ""} ${eventIndex > index ? "future" : ""}`}
                          >
                            <button
                              onClick={() => {
                                setIndex(eventIndex);
                                setPlaying(false);
                                setTechnical(false);
                              }}
                              aria-current={current ? "true" : undefined}
                            >
                              <span className="timeline-dot">
                                {/Breach/.test(e.eventType) ? (
                                  <TriangleAlert size={13} />
                                ) : null}
                              </span>
                              <div className="timeline-event-body">
                                <div className="timeline-title">
                                  <strong>{humanize(e.eventType)}</strong>
                                  <time dateTime={e.occurredAtUtc}>
                                    {new Date(
                                      e.occurredAtUtc,
                                    ).toLocaleTimeString()}
                                  </time>
                                </div>
                                <p>
                                  {e.actorRole} <span>·</span> {e.sourceService}
                                </p>
                                <div className="timeline-tags">
                                  {e.evidenceKind === "Diagnostic" && (
                                    <span className="event-tag">
                                      System observation
                                    </span>
                                  )}
                                  {e.orderingUncertain && (
                                    <span className="event-tag">
                                      Relative order uncertain
                                    </span>
                                  )}
                                  {e.missingCausation && (
                                    <span className="event-tag warning">
                                      Missing causal event
                                    </span>
                                  )}
                                  {isLate(e) && (
                                    <span className="event-tag warning">
                                      Late arrival
                                    </span>
                                  )}
                                  {e.retryCount == null ? (
                                    <span className="event-tag warning">
                                      Retry count unknown
                                    </span>
                                  ) : (
                                    e.retryCount > 0 && (
                                      <span className="event-tag warning">
                                        {e.retryCount}{" "}
                                        {e.retryCount === 1
                                          ? "retry"
                                          : "retries"}
                                      </span>
                                    )
                                  )}
                                  {/Pause|Resume|Override/.test(
                                    e.eventType,
                                  ) && (
                                    <span className="event-tag intervention">
                                      Supervisor action
                                    </span>
                                  )}
                                </div>
                              </div>
                              <ChevronRight size={15} />
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                  <p className="ordering-note">
                    The recorded projection preserves source sequences and
                    causation. Cross-service events with no causal link may have
                    uncertain relative order.
                  </p>
                </Panel>
                <aside className="replay-detail">
                  {selected && (
                    <Panel
                      title="Event details"
                      description={`Event ${index + 1} of ${events.length}`}
                    >
                      <div className="event-detail-body">
                        <Status value={selected.processingStatus} />
                        <h3>{humanize(selected.eventType)}</h3>
                        <p className="muted">
                          {selected.sourceService} · v{selected.eventVersion}
                        </p>
                        <dl className="event-dl">
                          <div>
                            <dt>Evidence</dt>
                            <dd>
                              {selected.evidenceKind === "Diagnostic"
                                ? "Diagnostic observation"
                                : "Business event"}
                            </dd>
                          </div>
                          <div>
                            <dt>Occurred</dt>
                            <dd>{dateTime(selected.occurredAtUtc)}</dd>
                          </div>
                          <div>
                            <dt>Recorded</dt>
                            <dd>{dateTime(selected.recordedAtUtc)}</dd>
                          </div>
                          <div>
                            <dt>Received</dt>
                            <dd>{dateTime(selected.receivedAtUtc)}</dd>
                          </div>
                          <div>
                            <dt>Processed</dt>
                            <dd>{dateTime(selected.processedAtUtc)}</dd>
                          </div>
                          <div>
                            <dt>Arrival delay</dt>
                            <dd>
                              {selected.receivedAtUtc
                                ? `${Math.max(0, (Date.parse(selected.receivedAtUtc) - Date.parse(selected.occurredAtUtc)) / 1000).toFixed(2)} seconds`
                                : "Not recorded"}
                            </dd>
                          </div>
                          <div>
                            <dt>Actor</dt>
                            <dd>
                              {selected.actorId}
                              <small>{selected.actorRole}</small>
                            </dd>
                          </div>
                          <div>
                            <dt>Source sequence</dt>
                            <dd>{selected.sequenceNumber}</dd>
                          </div>
                        </dl>
                        <DeliveryEvidence
                          retryCount={selected.retryCount}
                          attempts={selected.attempts ?? []}
                        />
                        <TraceEvidence
                          key={selected.eventId}
                          workOrderId={workOrderId}
                          traceId={selected.traceId}
                          correlationId={selected.correlationId}
                        />
                        <button
                          className="technical-toggle"
                          onClick={() => setTechnical((v) => !v)}
                          aria-expanded={technical}
                        >
                          <Braces size={15} />
                          Technical evidence
                          <ChevronDown size={15} />
                        </button>
                        {technical && (
                          <pre className="technical-json">
                            {JSON.stringify(
                              {
                                eventId: selected.eventId,
                                causationId: selected.causationId,
                                spanId: selected.spanId,
                                schemaVersion: selected.schemaVersion,
                                integrityVerified: selected.integrityVerified,
                                orderingUncertain: selected.orderingUncertain,
                                missingCausation: selected.missingCausation,
                                payload: selected.eventPayload,
                              },
                              null,
                              2,
                            )}
                          </pre>
                        )}
                      </div>
                    </Panel>
                  )}
                  <Panel
                    title="Incident findings"
                    description="Facts from recorded evidence. No root cause is assumed."
                  >
                    <div className="findings">
                      <h4>Observed facts</h4>
                      {replay.data.summary.facts.length ? (
                        <ul>
                          {replay.data.summary.facts.map((fact, i) => (
                            <li key={i}>{fact}</li>
                          ))}
                        </ul>
                      ) : (
                        <p>No incident facts have been generated.</p>
                      )}
                      {replay.data.summary.inferences.length > 0 && (
                        <>
                          <h4>Inferences · require review</h4>
                          <ul>
                            {replay.data.summary.inferences.map((fact, i) => (
                              <li key={i}>{fact}</li>
                            ))}
                          </ul>
                        </>
                      )}
                    </div>
                  </Panel>
                </aside>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
