import { useState } from 'react';
import { etTime, fmt, money } from '../api';
import type { Analysis } from '../types';

interface Props {
  analysis: Analysis;
  onLog: (card: any) => Promise<void>;
  logging: boolean;
}

function ScoreRing({ score }: { score: number }) {
  const r = 23;
  const c = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(100, score)) / 100;
  const color = score >= 80 ? '#22c55e' : score >= 65 ? '#f5a524' : score >= 50 ? '#38bdf8' : '#f43f5e';
  return (
    <div className="score-ring" role="img" aria-label={`Confluence score ${score} of 100`}>
      <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
        <circle cx="28" cy="28" r={r} fill="none" stroke="var(--border-strong)" strokeWidth="4" />
        <circle
          cx="28" cy="28" r={r} fill="none" stroke={color} strokeWidth="4"
          strokeDasharray={`${c * filled} ${c}`} strokeLinecap="round"
        />
      </svg>
      <div className="val">{score}</div>
      <div className="cap">score</div>
    </div>
  );
}

export default function SignalCard({ analysis, onLog, logging }: Props) {
  const [showTicket, setShowTicket] = useState(false);
  const result = analysis.signal || {};
  const card = result.state === 'signal' ? result.signal : null;
  const expiresIn = card ? Math.max(0, Math.round((card.expires_ts - Date.now() / 1000) / 60)) : 0;

  if (!card) {
    const reasons = result.reasons || [];
    const best = result.best_score;
    return (
      <div className="card">
        <div className="card-head">
          <h3>Current decision</h3>
          <span className="pill" style={{ marginLeft: 'auto' }}>no trade</span>
        </div>
        <div className="card-body" style={{ display: 'grid', gap: 8 }}>
          <div className="row" style={{ gap: 8 }}>
            <span className="dir-badge flat">flat</span>
            <span style={{ color: 'var(--muted)', fontSize: 11.5 }}>
              {best !== undefined && best !== null ? `best setup scored ${best}` : 'no qualifying setup'}
            </span>
          </div>
          {reasons.map((r: any, i: number) => (
            <div key={i} className="alert info" style={{ marginBottom: 0 }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--faint)' }}>{r.code}</span>
              <span>{r.message}</span>
            </div>
          ))}
          {(result.candidates || []).length > 0 && (
            <table className="grid">
              <thead>
                <tr><th>Setup</th><th>Dir</th><th style={{ textAlign: 'right' }}>Score</th><th style={{ textAlign: 'right' }}>R:R</th></tr>
              </thead>
              <tbody>
                {result.candidates.map((c: any, i: number) => (
                  <tr key={i} title={c.regime_reason}>
                    <td>{c.label}</td>
                    <td className={c.direction === 'long' ? 'up' : 'down'}>{c.direction}</td>
                    <td className="n">{c.score}</td>
                    <td className="n">{c.rr}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {(analysis.strategies?.errors || []).length > 0 && (
            <div className="alert error" style={{ marginBottom: 0 }}>
              <div>
                <b>Strategy error</b>
                <div>{analysis.strategies.errors.join(' · ')}</div>
              </div>
            </div>
          )}
          <div className="footer-note" style={{ borderTop: 0, padding: 0 }}>
            The engine stays flat until a setup clears every filter. Standing down is a result, so it is reported with the reasons that blocked it.
          </div>
        </div>
      </div>
    );
  }

  const dirClass = card.direction === 'long' ? 'long' : 'short';
  const size = card.size;
  return (
    <div className={`signal-card ${dirClass}`}>
      <div className="signal-head">
        <span className={`dir-badge ${dirClass}`}>{card.direction}</span>
        <div>
          <div className="signal-title">{card.strategy_label}</div>
          <div className="signal-sub mono">
            {card.contract} · {card.timeframe} · {etTime(card.created_ts, true)} ET
          </div>
        </div>
        <ScoreRing score={card.score} />
      </div>

      <div className="pricegrid">
        <div className="cell entry">
          <div className="k">Entry ({card.entry.type})</div>
          <div className="v">{fmt(card.entry.price, 2)}</div>
          <div className="s">{card.entry.alternative_price ? `alt ${card.entry.alternative_type} ${fmt(card.entry.alternative_price)}` : ' '}</div>
        </div>
        <div className="cell stop">
          <div className="k">Stop</div>
          <div className="v">{fmt(card.stop.price, 2)}</div>
          <div className="s">{card.stop.ticks} ticks · {money(card.stop.risk_per_contract)}/ct</div>
        </div>
        {card.targets.map((t: any) => (
          <div className="cell target" key={t.label}>
            <div className="k">{t.label} · {t.rr}R</div>
            <div className="v">{fmt(t.price, 2)}</div>
            <div className="s">{money(t.reward_dollars)}</div>
          </div>
        ))}
        <div className="cell">
          <div className="k">Size</div>
          <div className="v">{size.contracts}</div>
          <div className="s">limited by {size.binding_label}</div>
        </div>
        <div className="cell">
          <div className="k">Risk</div>
          <div className="v down">{money(size.risk_dollars)}</div>
          <div className="s">budget {money(size.effective_budget)}</div>
        </div>
        <div className="cell">
          <div className="k">Reward (T1)</div>
          <div className="v up">{money(size.reward_dollars)}</div>
          <div className="s">R:R {fmt(size.rr, 2)}</div>
        </div>
        <div className="cell">
          <div className="k">Expires</div>
          <div className="v">{expiresIn}m</div>
          <div className="s">{card.expiry_bars} bars · {etTime(card.expires_ts)} ET</div>
        </div>
      </div>

      <div className="reasons">
        {card.reasons.map((r: any, i: number) => (
          <div className="reason" key={i}>
            <span className="tag">{r.factor}</span>
            <span className="txt">{r.detail}</span>
          </div>
        ))}
        <div className="reason">
          <span className="tag">stop</span>
          <span className="txt">{card.stop.reason}</span>
        </div>
        <div className="reason">
          <span className="tag">invalid</span>
          <span className="txt">{card.invalidation}</span>
        </div>
      </div>

      <div className="card-head" style={{ borderTop: '1px solid var(--border)' }}>
        <h3>Score breakdown</h3>
        <span className="mono" style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 10.5 }}>
          tech {card.score_detail.technical_score} / fund {card.score_detail.fundamental_score}
        </span>
      </div>
      <div className="card-body" style={{ display: 'grid', gap: 7 }}>
        {card.score_detail.factors.map((f: any) => (
          <div className="factor" key={f.key} title={`${f.detail} (weight ${(f.weight * 100).toFixed(0)}%)`}>
            <span style={{ color: 'var(--muted)' }}>{f.label}</span>
            <span className="bar"><i style={{ width: `${f.raw * 100}%` }} /></span>
            <span className="n">{f.score}</span>
          </div>
        ))}
      </div>

      <div className="checks">
        {card.checks.map((c: any, i: number) => (
          <div className={`check ${c.passed ? 'ok' : 'no'}`} key={i}>
            <span className="mark">{c.passed ? '✓' : '✕'}</span>
            <span>{c.label} <span className="d">· {c.detail}</span></span>
          </div>
        ))}
      </div>

      <div className="card-body" style={{ borderTop: '1px solid var(--border)', display: 'grid', gap: 8 }}>
        <div className="row">
          <button className="btn" onClick={() => onLog(card)} disabled={logging}>
            {logging ? 'Logging…' : 'Log signal'}
          </button>
          <button className="btn ghost small" onClick={() => setShowTicket((v) => !v)} aria-expanded={showTicket}>
            {showTicket ? 'Hide' : 'Show'} NinjaTrader ticket
          </button>
          <button
            className="btn ghost small"
            onClick={() => navigator.clipboard?.writeText(card.ninjatrader.text)}
            aria-label="Copy NinjaTrader ticket text to the clipboard"
          >
            Copy ticket
          </button>
          <span className="pill" style={{ marginLeft: 'auto' }}>{card.score_label}</span>
        </div>
        {showTicket && <div className="ticket">{card.ninjatrader.text}</div>}
        <div style={{ color: 'var(--faint)', fontSize: 10.5 }}>
          {card.disclaimer}
        </div>
      </div>
    </div>
  );
}
