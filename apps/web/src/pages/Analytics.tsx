import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Field, Input, Select } from "@fluentui/react-components";
import {
  Activity,
  ArrowDownToLine,
  BarChart3,
  CheckCheck,
  CheckCircle2,
  Clock3,
  Info,
  RefreshCw,
  TriangleAlert,
  TrendingUp,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, download } from "../api";
import { percent } from "../format";
import {
  Empty,
  ErrorState,
  Freshness,
  InlineMessage,
  Loading,
  Metric,
  PageHeader,
  Panel,
} from "../components/common";
import type { Reports } from "../types";
import { WarehousePatterns } from "../components/WarehousePatterns";

type Indicator = {
  label: string;
  tone: "green" | "amber" | "red" | "neutral";
};

type Highlight = {
  key: string;
  title: string;
  text: string;
  tone: Indicator["tone"];
};

function higherRateIndicator(
  value: number | null,
  target: number,
  watchFloor: number,
): Indicator {
  if (value == null) return { label: "No data", tone: "neutral" };
  if (value >= target) return { label: "On target", tone: "green" };
  if (value >= watchFloor) return { label: "Watch", tone: "amber" };
  return { label: "At risk", tone: "red" };
}

function lowerRateIndicator(
  value: number | null,
  target: number,
  watchCeiling: number,
): Indicator {
  if (value == null) return { label: "No data", tone: "neutral" };
  if (value <= target) return { label: "On target", tone: "green" };
  if (value <= watchCeiling) return { label: "Watch", tone: "amber" };
  return { label: "At risk", tone: "red" };
}

function countIndicator(value: number, watchCeiling: number): Indicator {
  if (value === 0) return { label: "Clear", tone: "green" };
  if (value <= watchCeiling) return { label: "Watch", tone: "amber" };
  return { label: "Action needed", tone: "red" };
}

function selectedDate(value: string) {
  if (!value) return "";
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function reportHighlights(report: Reports): Highlight[] {
  const highlights: Highlight[] = [];
  if (report.slaComplianceRate != null) {
    const status = higherRateIndicator(report.slaComplianceRate, 0.95, 0.85);
    highlights.push({
      key: "sla",
      title: "SLA health",
      text: `${percent(report.slaComplianceRate)} of completed stages met SLA against a 95% target.`,
      tone: status.tone,
    });
  }
  highlights.push({
    key: "overdue",
    title: "Dispatch attention",
    text:
      report.overdueStages > 0
        ? `${report.overdueStages.toLocaleString()} stages are past SLA${report.activeJobs ? ` across ${report.activeJobs.toLocaleString()} active jobs` : ""}.`
        : "No overdue stages in the selected cohort.",
    tone: report.overdueStages > 0 ? "red" : "green",
  });
  if (report.schedulingEfficiency != null) {
    const status = higherRateIndicator(report.schedulingEfficiency, 0.8, 0.65);
    highlights.push({
      key: "coverage",
      title: "Booking coverage",
      text: `${percent(report.schedulingEfficiency)} of selected orders have a confirmed booking; target ≥ 80%.`,
      tone: status.tone,
    });
  }
  return highlights;
}

export function Analytics() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [category, setCategory] = useState("");
  const [technician, setTechnician] = useState("");
  const [exportError, setExportError] = useState("");
  const query = new URLSearchParams();
  if (from) query.set("from", new Date(`${from}T00:00:00`).toISOString());
  if (to) {
    const endExclusive = new Date(`${to}T00:00:00`);
    endExclusive.setDate(endExclusive.getDate() + 1);
    query.set("to", endExclusive.toISOString());
  }
  if (category) query.set("serviceCategory", category);
  if (technician) query.set("technicianId", technician);
  const report = useQuery({
    queryKey: ["reports", query.toString()],
    queryFn: () => api<Reports>(`/api/reports/summary?${query}`),
    refetchInterval: 30000,
  });
  const clearFilters = () => {
    setFrom("");
    setTo("");
    setCategory("");
    setTechnician("");
    setExportError("");
  };
  const exportFile = async (extension: "csv" | "pdf") => {
    setExportError("");
    try {
      await download(
        `/api/reports/export.${extension}?${query}`,
        `fieldops-operational-report-${new Date().toISOString().slice(0, 10)}.${extension}`,
      );
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Export failed.");
    }
  };
  const r = report.data;
  const hasFilters = Boolean(from || to || category || technician);
  const dateScope =
    from || to
      ? `${from ? selectedDate(from) : "Earliest date"} – ${to ? selectedDate(to) : "Today"}`
      : "All history";
  const completionIndicator = higherRateIndicator(
    r?.completionRate ?? null,
    0.7,
    0.5,
  );
  const slaIndicator = higherRateIndicator(
    r?.slaComplianceRate ?? null,
    0.95,
    0.85,
  );
  const atRiskIndicator = countIndicator(r?.atRiskStages ?? 0, 5);
  const overdueIndicator = countIndicator(r?.overdueStages ?? 0, 5);
  const highlights = r ? reportHighlights(r) : [];
  return (
    <>
      <PageHeader
        eyebrow="OPERATIONS ANALYTICS"
        title="Analytics"
        description="Validated service performance, capacity, and trends from the reporting warehouse."
        actions={
          <>
            <Button
              icon={<RefreshCw size={16} />}
              onClick={() => void report.refetch()}
              disabled={report.isFetching}
            >
              Refresh
            </Button>
            <Button
              icon={<ArrowDownToLine size={16} />}
              onClick={() => void exportFile("csv")}
            >
              Export CSV
            </Button>
            <Button
              icon={<ArrowDownToLine size={16} />}
              onClick={() => void exportFile("pdf")}
            >
              Export PDF
            </Button>
          </>
        }
      />
      <div className="analytics-filter">
        <Field label="From date">
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label="Through date">
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
        <Field label="Service category">
          <Select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">All categories</option>
            {r?.categoryBreakdown.map((c) => (
              <option key={c.category}>{c.category}</option>
            ))}
          </Select>
        </Field>
        <Field label="Technician">
          <Select
            value={technician}
            onChange={(e) => setTechnician(e.target.value)}
          >
            <option value="">All technicians</option>
            {r?.technicianUtilization.map((t) => (
              <option key={t.technicianId}>{t.technicianId}</option>
            ))}
          </Select>
        </Field>
        <Freshness value={r?.refreshedAtUtc} />
      </div>
      <div className="report-scope" aria-label="Current report scope">
        <span className="report-scope-label">REPORT SCOPE</span>
        <span className="report-scope-chip">{dateScope}</span>
        <span className="report-scope-chip">
          {category || "All categories"}
        </span>
        <span className="report-scope-chip">
          {technician ? "Selected technician" : "All technicians"}
        </span>
        {hasFilters && (
          <Button appearance="subtle" size="small" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </div>
      {exportError && <InlineMessage>{exportError}</InlineMessage>}
      {report.isPending ? (
        <Loading label="Loading validated warehouse metrics…" />
      ) : report.isError ? (
        <ErrorState error={report.error} retry={() => void report.refetch()} />
      ) : (
        r && (
          <>
            <div className="analytics-scorecard-heading">
              <div>
                <div className="eyebrow">PERFORMANCE SCORECARD</div>
                <h2>Key performance indicators</h2>
              </div>
              <span className="scorecard-targets">
                Targets: completion ≥ 70% · SLA ≥ 95% · booking coverage ≥ 80%
              </span>
            </div>
            <div className="metrics-grid">
              <Metric
                label="Total work orders"
                value={r.totalWorkOrders.toLocaleString()}
                note={`${r.completedWorkOrders.toLocaleString()} completed`}
                icon={<BarChart3 size={20} />}
              />
              <Metric
                label="Completion rate"
                value={percent(r.completionRate)}
                note={
                  r.completionRate == null
                    ? "Not available: no orders in scope"
                    : "Completed / total · target ≥ 70%"
                }
                icon={<CheckCheck size={20} />}
                tone="green"
                indicator={completionIndicator}
              />
              <Metric
                label="SLA compliance"
                value={percent(r.slaComplianceRate)}
                note={
                  r.slaComplianceRate == null
                    ? "Not available: no completed stages"
                    : "Stages without breach · target ≥ 95%"
                }
                icon={<TrendingUp size={20} />}
                tone="green"
                indicator={slaIndicator}
              />
              <Metric
                label="Average stage time"
                value={
                  r.averageStageMinutes == null ? (
                    "—"
                  ) : (
                    <>
                      {r.averageStageMinutes.toFixed(1)}
                      <small> min</small>
                    </>
                  )
                }
                note={
                  r.averageServiceMinutes == null
                    ? "Average service time not available"
                    : `${r.averageServiceMinutes.toFixed(1)} min average service`
                }
                icon={<Clock3 size={20} />}
                tone="amber"
              />
              <Metric
                label="Active jobs"
                value={r.activeJobs.toLocaleString()}
                note="In progress in the selected cohort"
                icon={<Activity size={20} />}
                indicator={
                  r.activeJobs === 0
                    ? { label: "Clear", tone: "green" }
                    : { label: "Live", tone: "neutral" }
                }
              />
              <Metric
                label="At-risk stages"
                value={r.atRiskStages.toLocaleString()}
                note="Active stages flagged warning or critical"
                icon={<TriangleAlert size={20} />}
                tone="amber"
                indicator={atRiskIndicator}
              />
              <Metric
                label="Overdue stages"
                value={r.overdueStages.toLocaleString()}
                note="Stages past their SLA deadline"
                icon={<Clock3 size={20} />}
                tone="red"
                indicator={overdueIndicator}
              />
              <Metric
                label="Completed today"
                value={r.completedToday.toLocaleString()}
                note="Closed during the current UTC day"
                icon={<CheckCircle2 size={20} />}
                tone="green"
                indicator={{ label: "Today", tone: "neutral" }}
              />
            </div>
            {highlights.length > 0 && (
              <div
                className="analytics-highlights"
                aria-label="Report highlights"
              >
                {highlights.map((highlight) => (
                  <article
                    key={highlight.key}
                    className={`analytics-highlight ${highlight.tone}`}
                  >
                    <span
                      className="analytics-highlight-signal"
                      aria-hidden="true"
                    />
                    <div>
                      <strong>{highlight.title}</strong>
                      <p>{highlight.text}</p>
                    </div>
                  </article>
                ))}
              </div>
            )}
            <div className="analytics-grid">
              <Panel
                title="Work order volume"
                description="Service demand and completions by day."
                action={
                  <span className="chart-key">
                    <i />
                    Created
                    <i className="green-dot" />
                    Completed
                  </span>
                }
              >
                {r.volumeTrend.length ? (
                  <>
                    <div
                      className="chart"
                      role="img"
                      aria-label="Work order volume trend chart"
                    >
                      <ResponsiveContainer width="100%" height={260}>
                        <AreaChart
                          data={r.volumeTrend}
                          margin={{ top: 10, right: 15, left: -20, bottom: 0 }}
                        >
                          <defs>
                            <linearGradient
                              id="volumeFill"
                              x1="0"
                              y1="0"
                              x2="0"
                              y2="1"
                            >
                              <stop
                                offset="0%"
                                stopColor="#4078cf"
                                stopOpacity={0.2}
                              />
                              <stop
                                offset="100%"
                                stopColor="#4078cf"
                                stopOpacity={0}
                              />
                            </linearGradient>
                          </defs>
                          <CartesianGrid
                            strokeDasharray="3 4"
                            vertical={false}
                            stroke="#e9edf3"
                          />
                          <XAxis
                            dataKey="date"
                            axisLine={false}
                            tickLine={false}
                            fontSize={11}
                          />
                          <YAxis
                            axisLine={false}
                            tickLine={false}
                            fontSize={11}
                            allowDecimals={false}
                          />
                          <Tooltip />
                          <Area
                            type="monotone"
                            dataKey="total"
                            name="Created"
                            stroke="#4078cf"
                            strokeWidth={2}
                            fill="url(#volumeFill)"
                          />
                          <Area
                            type="monotone"
                            dataKey="completed"
                            name="Completed"
                            stroke="#399c83"
                            strokeWidth={2}
                            fill="transparent"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="chart-data-table">
                      <table>
                        <caption>Work order volume by reporting date</caption>
                        <thead>
                          <tr>
                            <th scope="col">Date</th>
                            <th scope="col">Created</th>
                            <th scope="col">Completed</th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.volumeTrend.map((point) => (
                            <tr key={point.date}>
                              <th scope="row">{point.date}</th>
                              <td>{point.total}</td>
                              <td>{point.completed}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <Empty
                    title="Waiting for service history"
                    description="Volume trends appear after the ingestion worker processes work order events."
                  />
                )}
              </Panel>
              <Panel
                title="Service mix"
                description="Work order distribution by category."
              >
                {r.categoryBreakdown.length ? (
                  <div className="category-bars">
                    {r.categoryBreakdown.map((c, i) => (
                      <div key={c.category}>
                        <div>
                          <span>
                            <i
                              style={{
                                background: [
                                  "#346cc4",
                                  "#6c91cf",
                                  "#60ae99",
                                  "#b09ac8",
                                  "#a1afbf",
                                ][i % 5],
                              }}
                            />
                            {c.category}
                          </span>
                          <strong>{c.count}</strong>
                        </div>
                        <div className="category-track">
                          <span
                            style={{
                              width: `${r.totalWorkOrders ? (c.count / r.totalWorkOrders) * 100 : 0}%`,
                              background: [
                                "#346cc4",
                                "#6c91cf",
                                "#60ae99",
                                "#b09ac8",
                                "#a1afbf",
                              ][i % 5],
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty
                    title="No category data"
                    description="Category totals will be available after ingestion."
                  />
                )}
                {r.categoryBreakdown.length ? (
                  <div className="chart-data-table">
                    <table>
                      <caption>Work orders by service category</caption>
                      <thead>
                        <tr>
                          <th scope="col">Service category</th>
                          <th scope="col">Work orders</th>
                          <th scope="col">Share</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.categoryBreakdown.map((category) => (
                          <tr key={category.category}>
                            <th scope="row">{category.category}</th>
                            <td>{category.count}</td>
                            <td>
                              {r.totalWorkOrders
                                ? percent(category.count / r.totalWorkOrders)
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty
                    title="No category data"
                    description="Category totals will be available after ingestion."
                  />
                )}
              </Panel>
              <Panel
                title="Stage duration & breaches"
                description="Average effective stage duration excludes approved pauses."
              >
                {r.stageMetrics.length ? (
                  <div
                    className="chart"
                    role="img"
                    aria-label="Stage duration and breach comparison"
                  >
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart
                        data={r.stageMetrics}
                        margin={{ left: -15, right: 15, bottom: 30 }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 4"
                          vertical={false}
                          stroke="#e9edf3"
                        />
                        <XAxis
                          dataKey="stage"
                          fontSize={10}
                          tickLine={false}
                          axisLine={false}
                          angle={-25}
                          textAnchor="end"
                          height={70}
                        />
                        <YAxis
                          fontSize={11}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip />
                        <Legend />
                        <Bar
                          name="Average minutes"
                          dataKey="averageMinutes"
                          fill="#5d89cb"
                          radius={[4, 4, 0, 0]}
                        />
                        <Bar
                          name="Breaches"
                          dataKey="breaches"
                          fill="#dc9a60"
                          radius={[4, 4, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <Empty
                    title="No completed stage data"
                    description="Complete a guided workflow to populate duration metrics."
                  />
                )}
              </Panel>
              <Panel
                title="Technician utilization"
                description="Confirmed booked time as a share of working capacity."
              >
                {r.technicianUtilization.length ? (
                  <div className="utilization-list">
                    {r.technicianUtilization.map((t) => (
                      <div key={t.technicianId}>
                        <div>
                          <span className="mini-avatar">
                            {t.technicianId.slice(-2).toUpperCase()}
                          </span>
                          <strong>{t.technicianId}</strong>
                          <span>{percent(t.utilization)}</span>
                        </div>
                        {t.utilization != null &&
                        Number.isFinite(t.utilization) ? (
                          <div className="utilization-track">
                            <span
                              style={{
                                width: `${Math.max(0, Math.min(t.utilization * 100, 100))}%`,
                              }}
                            />
                          </div>
                        ) : (
                          <small>
                            Utilization not available for this interval.
                          </small>
                        )}
                        <small>
                          {t.bookedMinutes.toFixed(0)} booked minutes
                        </small>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty
                    title="No booking data"
                    description="Utilization is calculated from confirmed booking events."
                  />
                )}
              </Panel>
            </div>
            <WarehousePatterns report={r} />
            <div className="metric-definitions" id="definitions">
              <Info size={18} />
              <div>
                <strong>Understand the numbers</strong>
                <p>
                  Reporting is eventually consistent with operations. Freshness
                  reflects the latest ingestion. Completion rate uses work order
                  counts; SLA compliance uses completed stages. Empty
                  populations and unknown durations or capacity display
                  unavailable values rather than assumed zero. Customer
                  information is masked for analyst access.
                </p>
                {r.dataSource && (
                  <p className="analytics-data-source">{r.dataSource}</p>
                )}
              </div>
            </div>
            <Panel
              title="Metric drill-down"
              description="The underlying stage aggregates used by the visualizations."
            >
              <div className="table-scroll">
                <table>
                  <caption className="sr-only">
                    Stage-level effective duration, observed volume and SLA
                    breach rate
                  </caption>
                  <thead>
                    <tr>
                      <th>Workflow stage</th>
                      <th>Observed stages</th>
                      <th>Average effective minutes</th>
                      <th>SLA breaches</th>
                      <th>Breach rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.stageMetrics.map((s) => (
                      <tr key={s.stage}>
                        <td>{s.stage}</td>
                        <td>{s.count}</td>
                        <td>
                          {s.averageMinutes == null
                            ? "Not available"
                            : s.averageMinutes.toFixed(2)}
                        </td>
                        <td>{s.breaches}</td>
                        <td>{s.count ? percent(s.breaches / s.count) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </>
        )
      )}
    </>
  );
}
