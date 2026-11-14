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

function selectedDate(value: string) {
  if (!value) return "";
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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
  return (
    <>
      <PageHeader
        title="Analytics"
        actions={
          <>
            <Button
              icon={<RefreshCw aria-hidden="true" size={16} />}
              onClick={() => void report.refetch()}
              disabled={report.isFetching}
            >
              Refresh
            </Button>
            <Button
              icon={<ArrowDownToLine aria-hidden="true" size={16} />}
              onClick={() => void exportFile("csv")}
            >
              Export CSV
            </Button>
            <Button
              icon={<ArrowDownToLine aria-hidden="true" size={16} />}
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
            name="from-date"
            autoComplete="off"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label="Through date">
          <Input
            name="through-date"
            autoComplete="off"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
        <Field label="Service category">
          <Select
            name="service-category"
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
            name="technician"
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
            <h2 className="analytics-scorecard-heading">Service performance</h2>
            <div className="metrics-grid">
              <Metric
                label="Total work orders"
                value={r.totalWorkOrders.toLocaleString()}
                note={`${r.completedWorkOrders.toLocaleString()} completed`}
                icon={<BarChart3 aria-hidden="true" size={20} />}
              />
              <Metric
                label="Completion rate"
                value={percent(r.completionRate)}
                note={
                  r.completionRate == null
                    ? "Not available: no orders in scope"
                    : "Completed / total · target ≥ 70%"
                }
                icon={<CheckCheck aria-hidden="true" size={20} />}
                tone="green"
              />
              <Metric
                label="SLA compliance"
                value={percent(r.slaComplianceRate)}
                note={
                  r.slaComplianceRate == null
                    ? "Not available: no completed stages"
                    : "Stages without breach · target ≥ 95%"
                }
                icon={<TrendingUp aria-hidden="true" size={20} />}
                tone="green"
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
                icon={<Clock3 aria-hidden="true" size={20} />}
                tone="amber"
              />
              <Metric
                label="Active jobs"
                value={r.activeJobs.toLocaleString()}
                note="In progress in the selected cohort"
                icon={<Activity aria-hidden="true" size={20} />}
              />
              <Metric
                label="At-risk stages"
                value={r.atRiskStages.toLocaleString()}
                note="Active stages flagged warning or critical"
                icon={<TriangleAlert aria-hidden="true" size={20} />}
                tone="amber"
              />
              <Metric
                label="Overdue stages"
                value={r.overdueStages.toLocaleString()}
                note="Stages past their SLA deadline"
                icon={<Clock3 aria-hidden="true" size={20} />}
                tone="red"
              />
              <Metric
                label="Completed today"
                value={r.completedToday.toLocaleString()}
                note="Closed during the current UTC day"
                icon={<CheckCircle2 aria-hidden="true" size={20} />}
                tone="green"
              />
            </div>
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
                          <CartesianGrid
                            strokeDasharray="3 4"
                            vertical={false}
                            stroke="var(--border)"
                          />
                          <XAxis
                            dataKey="date"
                            axisLine={false}
                            tickLine={false}
                            fontSize="var(--font-size-caption)"
                          />
                          <YAxis
                            axisLine={false}
                            tickLine={false}
                            fontSize="var(--font-size-caption)"
                            allowDecimals={false}
                          />
                          <Tooltip />
                          <Area
                            isAnimationActive={false}
                            type="monotone"
                            dataKey="total"
                            name="Created"
                            stroke="var(--chart-1)"
                            strokeWidth={2}
                            fill="none"
                          />
                          <Area
                            isAnimationActive={false}
                            type="monotone"
                            dataKey="completed"
                            name="Completed"
                            stroke="var(--color-success)"
                            strokeWidth={2}
                            fill="transparent"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                    <div
                      tabIndex={0}
                      role="region"
                      aria-label="Work order volume by reporting date"
                      className="chart-data-table"
                    >
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
                                  "var(--chart-1)",
                                  "var(--chart-2)",
                                  "var(--chart-3)",
                                  "var(--chart-4)",
                                  "var(--chart-5)",
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
                                "var(--chart-1)",
                                "var(--chart-2)",
                                "var(--chart-3)",
                                "var(--chart-4)",
                                "var(--chart-5)",
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
                  <div
                    tabIndex={0}
                    role="region"
                    aria-label="Work orders by service category"
                    className="chart-data-table"
                  >
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
                ) : null}
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
                          stroke="var(--border)"
                        />
                        <XAxis
                          dataKey="stage"
                          fontSize="var(--font-size-caption)"
                          tickLine={false}
                          axisLine={false}
                          angle={-25}
                          textAnchor="end"
                          height={70}
                        />
                        <YAxis
                          fontSize="var(--font-size-caption)"
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip />
                        <Legend />
                        <Bar
                          isAnimationActive={false}
                          name="Average minutes"
                          dataKey="averageMinutes"
                          fill="var(--chart-1)"
                          radius={[4, 4, 0, 0]}
                        />
                        <Bar
                          isAnimationActive={false}
                          name="Breaches"
                          dataKey="breaches"
                          fill="var(--color-danger)"
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
              <Info aria-hidden="true" size={18} />
              <div>
                <strong>Metric definitions</strong>
                <p>
                  Reports may lag operations. Completion rate counts work
                  orders; SLA compliance counts completed stages. Unknown
                  durations or capacity display no value. Customer information
                  is masked.
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
              <div
                tabIndex={0}
                role="region"
                aria-label="Stage-level effective duration, observed volume and SLA
                    breach rate"
                className="table-scroll"
              >
                <table>
                  <caption className="sr-only">
                    Stage-level effective duration, observed volume and SLA
                    breach rate
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Workflow stage</th>
                      <th scope="col">Observed stages</th>
                      <th scope="col">Average effective minutes</th>
                      <th scope="col">SLA breaches</th>
                      <th scope="col">Breach rate</th>
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
