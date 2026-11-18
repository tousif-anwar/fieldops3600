import { etDateTime, fmt, money, pct } from '../api';
import type { Analysis, Detail } from '../types';

export function BiasCard({ analysis }: { analysis: Analysis }) {
  const fund = analysis.fundamentals || {};
  const score = Number(fund.score || 0);
  const ctx = fund.index_context || {};
  const bias = fund.bias || 'neutral';
  return (
    <div className="card">
      <div className="card-head">
        <h3>Fundamental bias</h3>
        <span className={`bias-pill bias-${bias}`} style={{ marginLeft: 'auto' }}>{bias}</span>
      </div>
      <div className="card-body" style={{ display: 'grid', gap: 8 }}>
        <div className="bias-row">
          <span style={{ color: 'var(--muted)', fontSize: 11 }}>bear</span>
          <div className="meter" aria-hidden="true" title={`Bias score ${score >= 0 ? '+' : ''}${score.toFixed(2)} on a -1 to +1 scale`}>
            <span className="meter-mid" />
            <i className={score >= 0 ? 'pos' : 'neg'}
               style={{ left: score >= 0 ? '50%' : `${50 + score * 50}%`, width: `max(2px, ${Math.abs(score) * 50}%)` }} />
          </div>
          <span style={{ color: 'var(--muted)', fontSize: 11 }}>bull</span>
          <span className="mono" style={{ width: 38, textAlign: 'right' }}>{score >= 0 ? '+' : ''}{score.toFixed(2)}</span>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <span className="pill">VIX {fmt(ctx.vix?.value, 1)} {ctx.vix?.trend ? `· ${ctx.vix.trend}` : ''}</span>
          <span className="pill">10Y {fmt(ctx.yield_10y?.value, 2)}%</span>
          <span className="pill">DXY {fmt(ctx.dxy?.value, 1)}</span>
        </div>
        {fund.news_window && (
          <div className="alert warn" style={{ marginBottom: 0 }}>
            <span>⚑</span>
            <span>{fund.news_window_detail?.reason || 'High-impact release window'}. Size is cut by default.</span>
          </div>
        )}
        <div style={{ display: 'grid', gap: 4 }}>
          {(fund.reasons || []).slice(0, 5).map((r: string, i: number) => (
            <div key={i} className="bias-note">{r}</div>
          ))}
        </div>
        <div style={{ color: 'var(--faint)', fontSize: 10.5 }}>
          Bias filters setups and adjusts confidence. It never creates an entry on its own.
          Providers: {fund.providers?.calendar} / {fund.providers?.news} / {fund.providers?.index}.
        </div>
      </div>
    </div>
  );
}

export function LevelsCard({ analysis }: { analysis: Analysis }) {
  const levels = (analysis.session_levels || []) as any[];
  const zone = analysis.context?.profiles;
  return (
    <div className="card">
      <div className="card-head">
        <h3>Session levels</h3>
        <span className="pill" style={{ marginLeft: 'auto' }}>{analysis.context?.session?.phase}</span>
      </div>
      <div className="card-body" style={{ padding: '6px 10px' }}>
        <table className="grid">
          <thead>
            <tr><th>Level</th><th style={{ textAlign: 'right' }}>Price</th><th style={{ textAlign: 'right' }}>Ticks</th></tr>
          </thead>
          <tbody>
            {levels.map((lv) => (
              <tr key={lv.id} title={lv.detail}>
                <td><span aria-hidden="true" style={{ color: lv.color }}>■</span> {lv.label}</td>
                <td className="n">{fmt(lv.price, 2)}</td>
                <td className="n" style={{ color: lv.distance_ticks >= 0 ? 'var(--long)' : 'var(--short)' }}>
                  {lv.distance_ticks >= 0 ? '+' : ''}{lv.distance_ticks}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {zone?.session && (
          <div className="valuearea">
            {([['VAL', zone.session.val], ['POC', zone.session.poc], ['VAH', zone.session.vah]] as const).map(
              ([label, value]) => (
                <div key={label}>
                  <span className="k">{label}</span>
                  <span className="mono">{fmt(value as number, 2)}</span>
                </div>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function CalendarCard({ analysis }: { analysis: Analysis }) {
  const events = (analysis.fundamentals?.events || []) as any[];
  return (
    <div className="card">
      <div className="card-head">
        <h3>Economic calendar</h3>
        <span className="pill" style={{ marginLeft: 'auto' }}>{analysis.fundamentals?.providers?.calendar}</span>
      </div>
      <div className="card-body" style={{ padding: '6px 10px' }}>
        {events.length === 0 && <div className="empty">No releases in the window.</div>}
        {events.map((e, i) => (
          <div key={i} className="kv" title={`${e.name} · forecast ${e.forecast || 'n/a'} · prior ${e.prior || 'n/a'}`}>
            <span className="k">
              <span style={{
                display: 'inline-block', width: 6, height: 6, borderRadius: 3, marginRight: 6,
                background: e.impact === 'high' ? 'var(--short)' : e.impact === 'medium' ? 'var(--accent)' : 'var(--faint)',
              }} />
              {e.time_et} · {e.name}
            </span>
            <span className="v" style={{ color: 'var(--faint)' }}>{e.impact}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function HeadlinesCard({ analysis }: { analysis: Analysis }) {
  const headlines = (analysis.fundamentals?.headlines || []) as any[];
  if (!headlines.length) return null;
  return (
    <div className="card">
      <div className="card-head">
        <h3>Headlines</h3>
        <span className="pill" style={{ marginLeft: 'auto' }}>{analysis.fundamentals?.providers?.news}</span>
      </div>
      <div className="card-body" style={{ padding: '6px 10px' }}>
        {headlines.slice(0, 5).map((h, i) => (
          <div key={i} className="kv" title={(h.matched || []).join(', ')}>
            <span className="k" style={{ lineHeight: 1.35 }}>{h.time_et} · {h.text}</span>
            <span className="v" style={{
              color: h.label === 'bullish' ? 'var(--long)' : h.label === 'bearish' ? 'var(--short)' : 'var(--faint)',
            }}>{h.sentiment > 0 ? '+' : ''}{h.sentiment}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DetailCard({ detail, onClose }: { detail: Detail | null; onClose: () => void }) {
  if (!detail) return null;
  return (
    <div className="card" style={{ borderColor: 'var(--border-strong)' }}>
      <div className="card-head">
        <h3>Why this is drawn</h3>
        <button className="icon-btn" style={{ marginLeft: 'auto', padding: '2px 8px' }} onClick={onClose}>×</button>
      </div>
      <div className="card-body" style={{ display: 'grid', gap: 6 }}>
        <div style={{ fontWeight: 650 }}>{detail.title}</div>
        {detail.subtitle && <div style={{ color: 'var(--faint)', fontSize: 11 }}>{detail.subtitle}</div>}
        <div style={{ color: 'var(--muted)', fontSize: 11.5, lineHeight: 1.5 }}>{detail.body}</div>
        {(detail.meta || []).map((m, i) => (
          <div className="kv" key={i}><span className="k">{m.label}</span><span className="v">{m.value}</span></div>
        ))}
      </div>
    </div>
  );
}

export function WarningsCard({ analysis }: { analysis: Analysis }) {
  const warnings = (analysis.warnings || []) as any[];
  const quality = analysis.quality || {};
  return (
    <div className="card honesty">
      <div className="card-head">
                  <h3>Data quality</h3>
        <span className="pill" style={{ marginLeft: 'auto' }}>{quality.bars} bars</span>
      </div>
      <div className="card-body" style={{ display: 'grid', gap: 6 }}>
        {warnings.map((w, i) => (
          <div key={i} className={`alert ${w.level === 'error' ? 'error' : w.level === 'warn' ? 'warn' : 'info'}`}
               style={{ marginBottom: 0 }}>
            <span>{w.level === 'error' ? '✕' : w.level === 'warn' ? '!' : 'i'}</span>
            <span>{w.message}</span>
          </div>
        ))}
        <div className="kv"><span className="k">Provider</span><span className="v">{analysis.provider?.id}</span></div>
        <div className="kv"><span className="k">Last bar age</span><span className="v">{Math.round((quality.last_bar_age_seconds || 0) / 60)} min</span></div>
        <div className="kv"><span className="k">Synthetic</span><span className="v">{String(analysis.provider?.synthetic)}</span></div>
        <div className="kv"><span className="k">Delayed</span><span className="v">{String(analysis.provider?.delayed)}</span></div>
        <div style={{ color: 'var(--faint)', fontSize: 10.5, lineHeight: 1.5 }}>
          {analysis.disclaimer}
        </div>
      </div>
    </div>
  );
}

export function PlanSummary({ analysis }: { analysis: Analysis }) {
  const card = analysis.signal?.state === 'signal' ? analysis.signal.signal : null;
  if (!card) return null;
  return (
    <div className="card">
      <div className="card-head"><h3>Plan checklist</h3></div>
      <div className="card-body" style={{ padding: '6px 10px' }}>
        {card.checks.map((c: any, i: number) => (
          <div className="kv" key={i}>
            <span className="k" style={{ color: c.passed ? 'var(--muted)' : 'var(--short)' }}>
              {c.passed ? '✓' : '✕'} {c.label}
            </span>
            <span className="v" style={{ fontSize: 10.5 }}>{c.detail}</span>
          </div>
        ))}
        <div className="kv" style={{ marginTop: 6 }}>
          <span className="k">Planning date</span>
          <span className="v">{etDateTime(card.created_ts)}</span>
        </div>
        <div className="kv"><span className="k">Risk budget</span><span className="v">{money(card.size.risk_dollars)}</span></div>
        <div className="kv"><span className="k">Binding limit</span><span className="v">{card.size.binding_label}</span></div>
      </div>
    </div>
  );
}
