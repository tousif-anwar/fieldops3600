import { useState, type KeyboardEvent, type ReactNode } from "react";
import { CalendarDays, TriangleAlert } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Reports } from "../types";
import { percent } from "../format";
import { Empty, Metric, Panel } from "./common";

function SourceFigures({
  caption,
  columns,
  children,
}: {
  caption: string;
  columns: string[];
  children: ReactNode;
}) {
  return (
    <details className="analytics-source-figures">
      <summary>View source figures</summary>
      <div className="table-scroll">
        <table>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th scope="col" key={column}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </details>
  );
}

export function WarehousePatterns({ report }: { report: Reports }) {
  const [view, setView] = useState("sla");
  const views = [
    { value: "sla", label: "SLA trend", tabId: "analytics-tab-sla" },
    { value: "duration", label: "Stage durations", tabId: "analytics-tab-duration" },
    {
      value: "interventions",
      label: "Supervisor actions",
      tabId: "analytics-tab-interventions",
    },
  ];
  const selectView = (value: string) => setView(value);
  const onTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    let nextIndex: number | undefined;
    if (event.key === "ArrowRight")
      nextIndex = (currentIndex + 1) % views.length;
    if (event.key === "ArrowLeft")
      nextIndex = (currentIndex - 1 + views.length) % views.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = views.length - 1;
    if (nextIndex == null) return;
    event.preventDefault();
    const next = views[nextIndex]!;
    selectView(next.value);
    requestAnimationFrame(() => document.getElementById(next.tabId)?.focus());
  };
  const compliance = report.slaComplianceTrend ?? [];
  const durations = report.stageDurationDistribution ?? [];
  const interventions = report.supervisorInterventionTrend ?? [];
  const hasKnownDurations = report.stageDurationSampleCount > 0;
  const chartCompliance = compliance.map((point) => ({
    ...point,
    compliancePercent:
      point.complianceRate == null ? null : point.complianceRate * 100,
  }));
  return (
    <section
      className="analytics-patterns"
      aria-label="Further service analysis"
    >
      <div className="analytics-secondary-metrics">
        <Metric
          label="Escalation share"
          value={percent(report.escalationFrequency)}
          note={
            report.escalationFrequency == null
              ? "Not available: no selected orders"
              : "Distinct orders with a recorded SLA breach / selected orders"
          }
          icon={<TriangleAlert size={20} />}
          tone="amber"
        />
        <Metric
          label="Confirmed-booking coverage"
          value={percent(report.schedulingEfficiency)}
          note={
            report.schedulingEfficiency == null
              ? "Not available: no selected orders"
              : "Orders with a currently confirmed booking / selected orders"
          }
          icon={<CalendarDays size={20} />}
        />
      </div>
      <p className="analytics-cohort-note">
        These figures follow the selected order creation cohort. Trend dates are
        UTC completion or action dates and can extend beyond the creation-date
        filter. Missing calendar days are not filled in. Booking coverage
        measures assignment coverage, not route or solver efficiency.
      </p>
      <div
        className="analytics-pattern-tabs"
        role="tablist"
        aria-label="Detailed analytical views"
      >
        {views.map((item, index) => (
          <button
            key={item.value}
            id={item.tabId}
            type="button"
            role="tab"
            aria-selected={view === item.value}
            aria-controls={`analytics-panel-${item.value}`}
            tabIndex={view === item.value ? 0 : -1}
            onClick={() => selectView(item.value)}
            onKeyDown={(event) => onTabKeyDown(event, index)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id="analytics-panel-sla"
        aria-labelledby="analytics-tab-sla"
        hidden={view !== "sla"}
      >
        {view === "sla" && (
          <Panel
            title="Completed-stage SLA compliance (UTC)"
            description="Stages without a recorded breach / completed stages, grouped by their UTC completion date."
          >
            {compliance.length ? (
              <>
                {compliance.some((point) => point.complianceRate != null) ? (
                  <div
                    className="chart"
                    role="img"
                    aria-label="SLA compliance by UTC completion date"
                  >
                    <ResponsiveContainer width="100%" height={260}>
                      <AreaChart
                        data={chartCompliance}
                        margin={{ top: 12, right: 22, left: 0, bottom: 8 }}
                      >
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
                          domain={[0, 100]}
                          tickFormatter={(value) => `${value}%`}
                          axisLine={false}
                          tickLine={false}
                          fontSize={11}
                        />
                        <Tooltip
                          formatter={(value) =>
                            typeof value === "number"
                              ? `${value.toFixed(1)}%`
                              : "Not available"
                          }
                        />
                        <Area
                          name="Compliant completed stages"
                          type="linear"
                          dataKey="compliancePercent"
                          stroke="#399c83"
                          fill="#399c8315"
                          strokeWidth={2}
                          dot={{ r: 4 }}
                          connectNulls={false}
                          isAnimationActive={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <Empty
                    title="SLA rate not available"
                    description="Recorded counts remain available below; an unknown denominator is not displayed as zero percent."
                  />
                )}
                <SourceFigures
                  caption="SLA compliance source figures by UTC completion date"
                  columns={[
                    "Completion date (UTC)",
                    "Completed stages",
                    "No recorded breach",
                    "Recorded breach",
                    "Compliance",
                  ]}
                >
                  {compliance.map((point) => (
                    <tr key={point.date}>
                      <td>{point.date}</td>
                      <td>{point.completedStages}</td>
                      <td>{point.compliantStages}</td>
                      <td>{point.breachedStages}</td>
                      <td>
                        {point.complianceRate == null
                          ? "Not available"
                          : percent(point.complianceRate)}
                      </td>
                    </tr>
                  ))}
                </SourceFigures>
              </>
            ) : (
              <Empty
                title="No completed-stage observations"
                description="The warehouse has no completed stages for these selected orders. No compliance rate is assumed."
              />
            )}
            <p className="analytics-evidence-note">
              Completed stages can contribute to SLA compliance even when their
              effective duration is unknown. Lines join observed dates only.
            </p>
          </Panel>
        )}
      </div>
      <div
        role="tabpanel"
        id="analytics-panel-duration"
        aria-labelledby="analytics-tab-duration"
        hidden={view !== "duration"}
      >
        {view === "duration" && (
          <Panel
            title="Effective stage-duration distribution"
            description="Observed completed-stage durations in half-open minute bands; approved pause time is excluded."
          >
            {hasKnownDurations ? (
              <>
                <p className="analytics-evidence-note">
                  {report.stageDurationSampleCount.toLocaleString()}{" "}
                  known-duration samples. True zero-minute durations are
                  observed data; missing or invalid durations are excluded.
                </p>
                <div
                  className="chart"
                  role="img"
                  aria-label="Known effective stage-duration histogram"
                >
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart
                      data={durations}
                      margin={{ top: 12, right: 22, left: 0, bottom: 8 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 4"
                        vertical={false}
                        stroke="#e9edf3"
                      />
                      <XAxis
                        dataKey="bucket"
                        axisLine={false}
                        tickLine={false}
                        fontSize={11}
                      />
                      <YAxis
                        allowDecimals={false}
                        axisLine={false}
                        tickLine={false}
                        fontSize={11}
                      />
                      <Tooltip />
                      <Bar
                        dataKey="count"
                        name="Observed stages"
                        fill="#5d89cb"
                        radius={[4, 4, 0, 0]}
                        isAnimationActive={false}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <SourceFigures
                  caption="Known stage-duration histogram source figures"
                  columns={["Effective duration (minutes)", "Observed stages"]}
                >
                  {durations.map((bin) => (
                    <tr key={bin.bucket}>
                      <td>
                        {bin.upperMinutes == null
                          ? `${bin.lowerMinutes} or more`
                          : `${bin.lowerMinutes} to <${bin.upperMinutes}`}
                      </td>
                      <td>{bin.count}</td>
                    </tr>
                  ))}
                </SourceFigures>
              </>
            ) : (
              <Empty
                title="No known stage-duration samples"
                description="A histogram requires valid recorded start, completion and pause timestamps. Zero-count bands alone do not establish a measured duration distribution."
              />
            )}
          </Panel>
        )}
      </div>
      <div
        role="tabpanel"
        id="analytics-panel-interventions"
        aria-labelledby="analytics-tab-interventions"
        hidden={view !== "interventions"}
      >
        {view === "interventions" && (
          <Panel
            title="Recorded supervisor actions (UTC)"
            description="Pause, resume, override and advisory-decision events grouped by their recorded UTC action date."
          >
            {interventions.length ? (
              <>
                <div
                  className="chart"
                  role="img"
                  aria-label="Supervisor action counts by UTC action date"
                >
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart
                      data={interventions}
                      margin={{ top: 12, right: 22, left: 0, bottom: 8 }}
                    >
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
                        allowDecimals={false}
                        axisLine={false}
                        tickLine={false}
                        fontSize={11}
                      />
                      <Tooltip />
                      <Bar
                        dataKey="interventions"
                        name="Recorded actions"
                        fill="#8b83b5"
                        radius={[4, 4, 0, 0]}
                        isAnimationActive={false}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <SourceFigures
                  caption="Supervisor action source figures by UTC action date"
                  columns={[
                    "Action date (UTC)",
                    "Recorded actions",
                    "Distinct affected orders",
                    "Recorded supervisors",
                  ]}
                >
                  {interventions.map((point) => (
                    <tr key={point.date}>
                      <td>{point.date}</td>
                      <td>{point.interventions}</td>
                      <td>{point.affectedWorkOrders}</td>
                      <td>{point.supervisors}</td>
                    </tr>
                  ))}
                </SourceFigures>
              </>
            ) : (
              <Empty
                title="No recorded supervisor actions"
                description="No pause, resume, override or advisory-decision events have reached this selected order cohort."
              />
            )}
            <p className="analytics-evidence-note">
              Several actions may refer to the same order. This is recorded
              action volume, not employee performance or an inferred incident
              count.
            </p>
          </Panel>
        )}
      </div>
    </section>
  );
}
