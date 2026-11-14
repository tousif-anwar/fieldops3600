import type { ReactNode } from "react";
import { Button, Spinner } from "@fluentui/react-components";
import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  RefreshCw,
} from "lucide-react";
import { ApiError } from "../api";
import { humanize } from "../format";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <hgroup>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </hgroup>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}
export function ErrorState({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  const forbidden = error instanceof ApiError && error.status === 403;
  return (
    <div className="error-state" role="alert">
      <AlertCircle size={22} aria-hidden="true" />
      <div>
        <strong>
          {forbidden
            ? "Access is restricted"
            : "Couldn’t load this information"}
        </strong>
        <p>
          {error instanceof Error
            ? error.message
            : "Check your connection and try again."}
        </p>
        {retry && (
          <Button icon={<RefreshCw size={15} />} onClick={retry}>
            Try again
          </Button>
        )}
      </div>
    </div>
  );
}
export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="loading-state" role="status">
      <Spinner size="small" label={label} />
    </div>
  );
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  );
}
export function Status({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  const tone = /breach|critical|overdue|fail|cancel|dead.?letter/.test(
    normalized,
  )
    ? "danger"
    : /warning|risk|pause|pending/.test(normalized)
      ? "warning"
      : /complete|success|resolved|ontime|on time|confirmed|operational/.test(
            normalized,
          )
        ? "success"
        : "neutral";
  return (
    <span className={`status status-${tone}`}>
      <span className="status-dot" aria-hidden="true" />
      {humanize(value)}
    </span>
  );
}
export function Metric({
  label,
  value,
  note,
  icon,
  tone = "blue",
  indicator,
}: {
  label: string;
  value: ReactNode;
  note?: string;
  icon?: ReactNode;
  tone?: string;
  indicator?: { label: string; tone?: "green" | "amber" | "red" | "neutral" };
}) {
  return (
    <article className="metric">
      <div className="metric-top">
        <span>{label}</span>
        {icon ? (
          <span className={`metric-icon ${tone}`} aria-hidden="true">
            {icon}
          </span>
        ) : null}
      </div>
      <strong className="metric-value">{value}</strong>
      {note || indicator ? (
        <div className="metric-note">
          <span>{note}</span>
          {indicator && (
            <span className={`metric-indicator ${indicator.tone ?? "neutral"}`}>
              {indicator.label}
            </span>
          )}
        </div>
      ) : null}
    </article>
  );
}
export function Panel({
  title,
  description,
  children,
  action,
  className = "",
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {title || description || action ? (
        <header className="panel-heading">
          {title ? <h2>{title}</h2> : null}
          {description && <p>{description}</p>}
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}
export function InlineMessage({
  children,
  success = false,
}: {
  children: ReactNode;
  success?: boolean;
}) {
  return (
    <div
      className={`inline-message ${success ? "positive" : ""}`}
      role={success ? "status" : "alert"}
    >
      {success ? (
        <CheckCircle2 size={17} aria-hidden="true" />
      ) : (
        <AlertCircle size={17} aria-hidden="true" />
      )}
      <span>{children}</span>
    </div>
  );
}
export function TextLink({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="text-link" onClick={onClick}>
      {children}
      <ArrowUpRight size={14} aria-hidden="true" />
    </button>
  );
}
export function Freshness({ value }: { value?: string | null }) {
  return (
    <span className="freshness">
      <Clock3 size={13} aria-hidden="true" />
      {value
        ? `Updated ${new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
        : "Awaiting ingestion"}
    </span>
  );
}
