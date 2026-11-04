import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Field, Input, Select } from "@fluentui/react-components";
import {
  ArrowDownToLine,
  BarChart3,
  CheckCheck,
  Clock3,
  Info,
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

export function Analytics() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [category, setCategory] = useState("");
  const [technician, setTechnician] = useState("");
  const [exportError, setExportError] = useState("");
  const query = new URLSearchParams();
  if (from) query.set("from", new Date(`${from}T00:00:00`).toISOString());
  if (to) query.set("to", new Date(`${to}T23:59:59`).toISOString());
  if (category) query.set("serviceCategory", category);
  if (technician) query.set("technicianId", technician);
  const report = useQuery({
    queryKey: ["reports", query.toString()],
    queryFn: () => api<Reports>(`/api/reports/summary?${query}`),
    refetchInterval: 30000,
  });
  const exportFile = async (extension: "csv" | "pdf") => {
    setExportError("");
    try {
      await download(
        `/api/reports/export.${extension}?${query}`,
        `fieldops-operational-report.${extension}`,
      );
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Export failed.");
    }
  };
  const r = report.data;
  return (
    <>
      <PageHeader
        eyebrow="OPERATIONAL INTELLIGENCE"
        title="See the patterns. Improve the next day."
        description="Warehouse-backed service metrics with clear definitions and traceable history."
        actions={
          <>
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
      {exportError && <InlineMessage>{exportError}</InlineMessage>}
      {report.isPending ? (
        <Loading label="Loading validated warehouse metrics…" />
      ) : report.isError ? (
        <ErrorState error={report.error} retry={() => void report.refetch()} />
      ) : (
        r && (
          <>
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
                note="Completed / total work orders"
                icon={<CheckCheck size={20} />}
                tone="green"
              />
              <Metric
                label="SLA compliance"
                value={percent(r.slaComplianceRate)}
                note="Stages completed without breach"
                icon={<TrendingUp size={20} />}
                tone="green"
              />
              <Metric
                label="Average stage time"
                value={
                  <>
                    {r.averageStageMinutes.toFixed(1)}
                    <small> min</small>
                  </>
                }
                note={`${r.averageServiceMinutes.toFixed(1)} min average service`}
                icon={<Clock3 size={20} />}
                tone="amber"
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
                        <div className="utilization-track">
                          <span
                            style={{
                              width: `${Math.min(t.utilization <= 1 ? t.utilization * 100 : t.utilization, 100)}%`,
                            }}
                          />
                        </div>
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
            <div className="metric-definitions">
              <Info size={18} />
              <div>
                <strong>Understand the numbers</strong>
                <p>
                  Reporting is eventually consistent with operations. Freshness
                  reflects the latest ingestion. Completion rate uses work order
                  counts; SLA compliance uses completed stages. Empty
                  populations display zero. Customer information is masked for
                  analyst access.
                </p>
              </div>
            </div>
            <Panel
              title="Metric drill-down"
              description="The underlying stage aggregates used by the visualizations."
            >
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Workflow stage</th>
                      <th>Observed stages</th>
                      <th>Average effective minutes</th>
                      <th>SLA breaches</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.stageMetrics.map((s) => (
                      <tr key={s.stage}>
                        <td>{s.stage}</td>
                        <td>{s.count}</td>
                        <td>{s.averageMinutes.toFixed(2)}</td>
                        <td>{s.breaches}</td>
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
