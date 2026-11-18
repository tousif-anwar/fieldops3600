import { useEffect, useState } from 'react';
import { etDateTime, fmt, getJSON, money, patchJSON, postJSON } from '../api';
import type { Analysis } from '../types';

// --------------------------------------------------------------------- utils
export function Sparkline({ points, height = 60 }: { points: number[]; height?: number }) {
  if (!points.length) return <div className="empty">No equity curve yet.</div>;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const w = 600;
  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(i / Math.max(1, points.length - 1)) * w},${height - ((p - min) / span) * height}`)
    .join(' ');
  const up = points[points.length - 1] >= points[0];
  return (
    <svg viewBox={`0 0 ${w} ${height}`} style={{ width: '100%', height, display: 'block' }}>
      <path d={`${d} L${w},${height} L0,${height} Z`} fill={up ? 'rgba(34,197,94,0.12)' : 'rgba(244,63,94,0.12)'} />
      <path d={d} fill="none" stroke={up ? 'var(--long)' : 'var(--short)'} strokeWidth="1.6" />
    </svg>
  );
}

function Stat({ k, v, s }: { k: string; v: any; s?: string }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {s && <div className="s">{s}</div>}
    </div>
  );
}

function WarningList({ warnings }: { warnings: string[] }) {
  if (!warnings?.length) return null;
  return (
    <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
      {warnings.map((w, i) => (
        <div className="alert warn" key={i} style={{ marginBottom: 0 }}>
          <span>!</span><span>{w}</span>
        </div>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------- backtest
export function BacktestPanel({ analysis, onRefresh }: { analysis: Analysis; onRefresh: () => void }) {
  const [bars, setBars] = useState(2500);
  const [includeFlow, setIncludeFlow] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [wf, setWf] = useState<any>(null);
  const [busy, setBusy] = useState<'bt' | 'wf' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy('bt');
    setError(null);
    try {
      const res = await postJSON('/api/backtest', {
        symbol: analysis.symbol,
        timeframe: analysis.timeframe,
        bars,
        include_orderflow: includeFlow,
      });
      setResult(res);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const walkforward = async () => {
    setBusy('wf');
    setError(null);
    try {
      const res = await postJSON('/api/backtest/walkforward', {
        symbol: analysis.symbol,
        timeframe: analysis.timeframe,
        bars: Math.min(bars, 4000),
        folds: 3,
      });
      setWf(res);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const m = result?.metrics;
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="row">
        <div className="input-row">
          <label>Bars to replay</label>
          <input type="number" value={bars} min={300} max={20000} step={100} aria-label="Bars to replay"
                 onChange={(e) => setBars(Number(e.target.value))} style={{ width: 120 }} />
        </div>
        <label className="row" style={{ gap: 6, marginTop: 14 }}>
          <input type="checkbox" checked={includeFlow} onChange={(e) => setIncludeFlow(e.target.checked)} />
          include tick/depth order flow (slower)
        </label>
        <button className="btn" onClick={run} disabled={busy !== null} style={{ marginTop: 14 }}>
          {busy === 'bt' ? 'Running…' : 'Run backtest'}
        </button>
        <button className="btn ghost" onClick={walkforward} disabled={busy !== null} style={{ marginTop: 14 }}>
          {busy === 'wf' ? 'Walking forward…' : 'Walk-forward + hold-out'}
        </button>
        <button className="btn ghost" onClick={onRefresh} style={{ marginTop: 14 }}>Refresh chart</button>
        {busy && <div className="spinner" style={{ marginTop: 18 }} />}
      </div>
      {error && <div className="alert error">{error}</div>}

      {result && m && (
        <>
          <div className="grid-4">
            <Stat k="Trades" v={m.trades} s={`${result.bars} bars · ${result.start_ts ? etDateTime(result.start_ts) : ''}`} />
            <Stat k="Win rate" v={m.win_rate === null ? '–' : `${m.win_rate}%`} s={`${m.wins}W / ${m.losses}L`} />
            <Stat k="Expectancy" v={m.expectancy_r === null ? '–' : `${m.expectancy_r > 0 ? '+' : ''}${m.expectancy_r}R`} s={`${money(m.expectancy_dollars)}/trade`} />
            <Stat k="Profit factor" v={m.profit_factor ?? '–'} s={`${money(m.gross_profit)} / ${money(-m.gross_loss)}`} />
            <Stat k="Net P&L" v={money(m.net_pnl)} s={`${money(m.total_commission)} commission`} />
            <Stat k="Max drawdown" v={money(m.max_drawdown)} s={`${m.max_drawdown_pct}% · ${m.max_drawdown_r}R`} />
            <Stat k="Avg win / loss" v={`${m.avg_win_r ?? '–'} / ${m.avg_loss_r ?? '–'}R`} s={`${fmt(m.avg_bars_held, 0)} bars held`} />
            <Stat k="Same-input hash" v={<span style={{ fontSize: 12 }}>{result.reproducible_hash}</span>} s="same inputs give the same hash" />
          </div>

          <div className="card">
            <div className="card-head"><h3>Equity curve (net of costs)</h3></div>
            <div className="card-body" style={{ padding: '4px 10px 10px' }}>
              <Sparkline points={(result.equity_curve || []).map((p: any) => p.equity)} />
            </div>
          </div>

          <div className="grid-2">
            {[
              ['By strategy', m.by_strategy],
              ['By session', m.by_session],
              ['By regime', m.by_regime],
              ['By day of week', m.by_day_of_week],
            ].map(([label, rows]: any) => (
              <div className="card" key={label}>
                <div className="card-head"><h3>{label}</h3></div>
                <div className="card-body" style={{ padding: '4px 8px' }}>
                  <table className="grid">
                    <thead>
                      <tr><th>Bucket</th><th style={{ textAlign: 'right' }}>N</th><th style={{ textAlign: 'right' }}>Win%</th><th style={{ textAlign: 'right' }}>Exp R</th><th style={{ textAlign: 'right' }}>Net</th></tr>
                    </thead>
                    <tbody>
                      {(rows || []).map((r: any) => (
                        <tr key={r.name}>
                          <td>{r.name}</td>
                          <td className="n">{r.trades}</td>
                          <td className="n">{r.win_rate ?? '–'}</td>
                          <td className="n" style={{ color: (r.expectancy_r || 0) >= 0 ? 'var(--long)' : 'var(--short)' }}>{r.expectancy_r ?? '–'}</td>
                          <td className="n">{money(r.net_pnl)}</td>
                        </tr>
                      ))}
                      {!rows?.length && <tr><td colSpan={5} className="empty">No trades.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>

          <WarningList warnings={result.warnings || []} />
          <div style={{ color: 'var(--faint)', fontSize: 10.5 }}>{m.caveat} {result.disclaimer}</div>

          <div className="card">
            <div className="card-head"><h3>Trades ({result.trades.length})</h3></div>
            <div className="card-body" style={{ padding: '4px 8px', maxHeight: 320, overflow: 'auto' }}>
              <table className="grid">
                <thead>
                  <tr>
                    <th>Entry</th><th>Dir</th><th>Setup</th><th style={{ textAlign: 'right' }}>Entry</th>
                    <th style={{ textAlign: 'right' }}>Stop</th><th style={{ textAlign: 'right' }}>Exit</th>
                    <th>Reason</th><th style={{ textAlign: 'right' }}>R</th><th style={{ textAlign: 'right' }}>P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {result.trades.slice().reverse().slice(0, 100).map((t: any) => (
                    <tr key={t.id} title={`MFE ${t.mfe_r}R / MAE ${t.mae_r}R · score ${t.score}`}>
                      <td className="mono" style={{ fontSize: 10.5 }}>{t.entry_time_et}</td>
                      <td className={t.direction === 'long' ? 'up' : 'down'}>{t.direction}</td>
                      <td>{t.strategy}</td>
                      <td className="n">{fmt(t.entry_price, 2)}</td>
                      <td className="n">{fmt(t.stop_initial, 2)}</td>
                      <td className="n">{fmt(t.avg_exit, 2)}</td>
                      <td>{t.exit_reason}</td>
                      <td className="n" style={{ color: t.r_multiple >= 0 ? 'var(--long)' : 'var(--short)' }}>{t.r_multiple}</td>
                      <td className="n">{money(t.pnl)}</td>
                    </tr>
                  ))}
                  {!result.trades.length && <tr><td colSpan={9} className="empty">No trades in this window.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {wf && (
        <div className="card">
          <div className="card-head">
            <h3>Walk-forward / out-of-sample</h3>
            <span className="pill" style={{ marginLeft: 'auto' }}>{wf.fold_count} folds</span>
          </div>
          <div className="card-body" style={{ display: 'grid', gap: 10 }}>
            {wf.error ? (
              <div className="alert error">{wf.error}</div>
            ) : (
              <>
                <div className="grid-4">
                  <Stat k="Out-of-sample trades" v={wf.oos_metrics?.trades ?? 0} />
                  <Stat k="Out-of-sample exp." v={`${wf.oos_metrics?.expectancy_r ?? '–'}R`} />
                  <Stat k="Out-of-sample PF" v={wf.oos_metrics?.profit_factor ?? '–'} />
                  <Stat k="Degradation" v={wf.expectancy_degradation_r ?? '–'} s="out-of-sample minus in-sample" />
                </div>
                <table className="grid">
                  <thead>
                    <tr><th>Fold</th><th style={{ textAlign: 'right' }}>Train bars</th><th style={{ textAlign: 'right' }}>Test bars</th>
                      <th>Parameters chosen</th><th style={{ textAlign: 'right' }}>IS exp</th><th style={{ textAlign: 'right' }}>OOS exp</th><th style={{ textAlign: 'right' }}>OOS n</th></tr>
                  </thead>
                  <tbody>
                    {(wf.folds || []).map((f: any) => (
                      <tr key={f.fold}>
                        <td>{f.fold}</td>
                        <td className="n">{f.train_bars}</td>
                        <td className="n">{f.test_bars}</td>
                        <td className="mono" style={{ fontSize: 10.5 }}>{f.chosen_params ? `th ${f.chosen_params.threshold} · rr ${f.chosen_params.min_rr}` : '–'}</td>
                        <td className="n">{f.in_sample?.expectancy_r ?? '–'}</td>
                        <td className="n">{f.out_of_sample?.expectancy_r ?? '–'}</td>
                        <td className="n">{f.out_of_sample?.trades ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="kv">
                  <span className="k">Hold-out segment, never tuned</span>
                  <span className="v">
                    {wf.holdout?.metrics?.trades ?? 0} trades · {wf.holdout?.metrics?.expectancy_r ?? '–'}R ·{' '}
                    {money(wf.holdout?.metrics?.net_pnl)}
                  </span>
                </div>
                <div style={{ color: 'var(--faint)', fontSize: 10.5 }}>{wf.method}</div>
                <WarningList warnings={wf.warnings || []} />
              </>
            )}
          </div>
        </div>
      )}

      {!result && !wf && (
        <div className="empty">
                      Backtests run the same signal code the app runs live, with commission, slippage, partial fills
          and stop-run fills. Run one to see what this data actually did.
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ journal
export function JournalPanel({ analysis, onChanged }: { analysis: Analysis; onChanged: () => void }) {
  const [entries, setEntries] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    const res = await getJSON('/api/journal?days=60&limit=200');
    setEntries(res.entries || []);
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (message) {
      const t = setTimeout(() => setMessage(null), 2500);
      return () => clearTimeout(t);
    }
  }, [message]);

  const logCurrent = async () => {
    const card = analysis.signal?.state === 'signal' ? analysis.signal.signal : null;
    if (!card) {
      setMessage('No active signal card to log.');
      return;
    }
    setBusy(true);
    try {
      await postJSON('/api/journal', { signal: card, taken: true, notes: 'Logged from the signal card' });
      await load();
      onChanged();
      setMessage('Signal added to the journal.');
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await patchJSON(`/api/journal/${editing.id}`, {
        taken: editing.taken,
        fill_price: editing.fill_price ? Number(editing.fill_price) : null,
        exit_price: editing.exit_price ? Number(editing.exit_price) : null,
        notes: editing.notes,
        size: editing.size ? Number(editing.size) : null,
      });
      setEditing(null);
      await load();
      onChanged();
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="row">
        <button className="btn" onClick={logCurrent} disabled={busy}>Log current signal</button>
        <button className="btn ghost" onClick={load}>Reload</button>
        {message && <span className="pill">{message}</span>}
        <span style={{ color: 'var(--faint)', fontSize: 10.5, marginLeft: 'auto' }}>
          You enter fill and exit prices yourself. The app never talks to a broker.
        </span>
      </div>

      {editing && (
        <div className="card">
          <div className="card-head"><h3>Edit entry</h3></div>
          <div className="card-body" style={{ display: 'grid', gap: 10 }}>
            <div className="grid-4">
              <div className="input-row"><label>Size</label>
                <input type="number" aria-label="Size" value={editing.size ?? ''} onChange={(e) => setEditing({ ...editing, size: e.target.value })} /></div>
              <div className="input-row"><label>Fill price</label>
                <input type="number" step="0.25" aria-label="Fill price" value={editing.fill_price ?? ''} onChange={(e) => setEditing({ ...editing, fill_price: e.target.value })} /></div>
              <div className="input-row"><label>Exit price</label>
                <input type="number" step="0.25" aria-label="Exit price" value={editing.exit_price ?? ''} onChange={(e) => setEditing({ ...editing, exit_price: e.target.value })} /></div>
              <div className="input-row"><label>Taken</label>
                <select aria-label="Whether you took the trade" value={editing.taken ? 'yes' : 'no'} onChange={(e) => setEditing({ ...editing, taken: e.target.value === 'yes' })}>
                  <option value="yes">yes</option><option value="no">no</option>
                </select></div>
            </div>
            <div className="input-row"><label>Notes</label>
              <textarea rows={3} aria-label="Notes" value={editing.notes ?? ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
            </div>
            <div className="row">
              <button className="btn" onClick={save} disabled={busy}>Save</button>
              <button className="btn ghost" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head"><h3>Journal ({entries.length})</h3></div>
        <div className="card-body" style={{ padding: '4px 8px', maxHeight: 420, overflow: 'auto' }}>
          <table className="grid">
            <thead>
              <tr>
                <th>Logged</th><th>Symbol</th><th>Dir</th><th>Setup</th>
                <th style={{ textAlign: 'right' }}>Entry</th><th style={{ textAlign: 'right' }}>Stop</th>
                <th style={{ textAlign: 'right' }}>Size</th><th style={{ textAlign: 'right' }}>R</th>
                <th style={{ textAlign: 'right' }}>$</th><th>Rules</th><th></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} title={e.notes || ''}>
                  <td className="mono" style={{ fontSize: 10.5 }}>{e.created_at ? etDateTime(e.created_at) : '–'}</td>
                  <td>{e.symbol}</td>
                  <td className={e.direction === 'long' ? 'up' : 'down'}>{e.direction}</td>
                  <td>{e.strategy}</td>
                  <td className="n">{fmt(e.entry, 2)}</td>
                  <td className="n">{fmt(e.stop, 2)}</td>
                  <td className="n">{e.size}</td>
                  <td className="n" style={{ color: (e.outcome_r || 0) >= 0 ? 'var(--long)' : 'var(--short)' }}>{e.outcome_r ?? '–'}</td>
                  <td className="n">{e.outcome_dollars === null ? '–' : money(e.outcome_dollars)}</td>
                  <td>{(e.rules_broken || []).length ? <span className="pill no">{(e.rules_broken || []).length}</span> : <span className="pill ok">clean</span>}</td>
                  <td><button className="btn ghost small" onClick={() => setEditing(e)}>Edit</button></td>
                </tr>
              ))}
              {!entries.length && <tr><td colSpan={11} className="empty">No journal entries yet. Log a signal to start.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- review
export function ReviewPanel() {
  const [days, setDays] = useState(7);
  const [review, setReview] = useState<any>(null);
  const load = async () => setReview(await getJSON(`/api/review?days=${days}`));
  useEffect(() => { load(); }, [days]);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="row">
        <div className="input-row"><label>Window</label>
          <select aria-label="Review window" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
          </select>
        </div>
        <button className="btn ghost" onClick={load}>Reload</button>
      </div>
      {!review ? <div className="empty">Loading…</div> : (
        <>
          <div className="grid-4">
            <Stat k="Signals logged" v={review.signals_logged} s={`${review.taken} taken · ${review.skipped} skipped`} />
            <Stat k="Closed trades" v={review.closed} s={`${review.open} still open`} />
            <Stat k="Total R" v={`${review.total_r >= 0 ? '+' : ''}${review.total_r}R`} s={money(review.total_dollars)} />
            <Stat k="Win rate" v={review.win_rate === null ? '–' : `${review.win_rate}%`} s={review.avg_r !== null ? `${review.avg_r}R avg` : ''} />
            <Stat k="Rule adherence" v={review.adherence_rate === null ? '–' : `${review.adherence_rate}%`} s="entries with no rule breaks" />
          </div>

          <div className="grid-2">
            {(review.by_strategy || []).map((r: any) => (
              <div className="card" key={r.name}>
                <div className="card-head"><h3>{r.name}</h3>
                  <span className="pill" style={{ marginLeft: 'auto' }}>{r.trades} trades</span></div>
                <div className="card-body">
                  <div className="kv"><span className="k">Total R</span><span className="v" style={{ color: r.total_r >= 0 ? 'var(--long)' : 'var(--short)' }}>{r.total_r}R</span></div>
                  <div className="kv"><span className="k">Dollars</span><span className="v">{money(r.dollars)}</span></div>
                  <div className="kv"><span className="k">Win rate</span><span className="v">{r.win_rate}%</span></div>
                  <div className="kv"><span className="k">Rule breaks</span><span className="v">{r.rule_breaks}</span></div>
                </div>
              </div>
            ))}
            {!(review.by_strategy || []).length && (
              <div className="empty">No closed trades in this window.</div>
            )}
          </div>

          <div className="card">
            <div className="card-head"><h3>Where rules were broken</h3></div>
            <div className="card-body">
              {(review.rule_breaks || []).length === 0 ? (
                <div className="empty">No rule breaks logged.</div>
              ) : (
                (review.rule_breaks || []).map((b: any, i: number) => (
                  <div className="kv" key={i}><span className="k">{b.rule}</span><span className="v">{b.count}</span></div>
                ))
              )}
              <div style={{ color: 'var(--faint)', fontSize: 10.5, marginTop: 8 }}>{review.caveat}</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// --------------------------------------------------------------------- plan
export function PlanPanel({ config, onSaved }: { config: any; onSaved: () => void }) {
  const [risk, setRisk] = useState<any>(config?.risk || {});
  const [margins, setMargins] = useState<Record<string, number>>(config?.risk?.margins || {});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setRisk(config?.risk || {}); }, [config]);

  const save = async () => {
    setBusy(true);
    try {
      await patchJSON('/api/config/risk', { patch: { ...risk, margins } });
      setMessage('Saved. Signals now use these inputs.');
      onSaved();
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  };

  const field = (key: string, label: string, step = 'any', type = 'number') => (
    <div className="input-row">
      <label>{label}</label>
      <input
        type={type} step={step} aria-label={label}
        value={risk[key] ?? ''}
        onChange={(e) => setRisk({ ...risk, [key]: type === 'number' ? Number(e.target.value) : e.target.value })}
      />
    </div>
  );

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="card">
        <div className="card-head"><h3>Account &amp; risk</h3>
          <span className="pill" style={{ marginLeft: 'auto' }}>your plan</span></div>
        <div className="card-body" style={{ display: 'grid', gap: 12 }}>
          <div className="grid-4">
            {field('account_size', 'Account size ($)', '100')}
            <div className="input-row">
              <label>Risk mode</label>
              <select aria-label="Risk mode" value={risk.risk_mode || 'dollars'} onChange={(e) => setRisk({ ...risk, risk_mode: e.target.value })}>
                <option value="dollars">fixed dollars</option>
                <option value="percent">percent of account</option>
              </select>
            </div>
            {risk.risk_mode === 'percent' ? field('risk_percent', 'Risk per trade (%)', '0.1') : field('risk_per_trade', 'Risk per trade ($)', '5')}
            {field('buying_power_per_trade', 'Buying power per trade ($)', '100')}
            {field('min_rr', 'Minimum R:R', '0.1')}
            {field('daily_max_loss', 'Daily max loss ($)', '10')}
            {field('max_trades_per_day', 'Max trades / day', '1')}
            {field('max_consecutive_losses', 'Max consecutive losses', '1')}
            {field('max_contracts', 'Max contracts', '1')}
            {field('fundamental_weight', 'Fundamental weight', '0.05')}
            {field('technical_weight', 'Technical weight', '0.05')}
            <div className="input-row">
              <label>Mode</label>
              <select aria-label="Strategy mode" value={risk.mode || 'both'} onChange={(e) => setRisk({ ...risk, mode: e.target.value })}>
                <option value="momentum">momentum</option>
                <option value="contra_trend">contra-trend</option>
                <option value="both">both</option>
              </select>
            </div>
          </div>
          <div className="row">
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" checked={Boolean(risk.stops_enabled)}
                     onChange={(e) => setRisk({ ...risk, stops_enabled: e.target.checked })} />
              stops enabled (required for sized cards)
            </label>
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" checked={Boolean(risk.allow_news_window_trades)}
                     onChange={(e) => setRisk({ ...risk, allow_news_window_trades: e.target.checked })} />
              allow entries during high-impact releases
            </label>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>Initial margin per contract (editable)</h3></div>
        <div className="card-body">
          <div className="grid-4">
            {(config?.markets || []).map((m: any) => (
              <div className="input-row" key={m.symbol}>
                <label>{m.symbol} margin ($)</label>
                <input type="number" step="50" aria-label={`${m.symbol} initial margin in dollars`}
                       value={margins[m.symbol] ?? m.margin}
                       onChange={(e) => setMargins({ ...margins, [m.symbol]: Number(e.target.value) })} />
              </div>
            ))}
          </div>
          <div style={{ color: 'var(--faint)', fontSize: 10.5, marginTop: 8 }}>
            Margin only caps size through the buying-power limit. It is not a broker requirement check.
          </div>
        </div>
      </div>

      <div className="row">
        <button className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save plan'}</button>
        {message && <span className="pill">{message}</span>}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- strategy
export function StrategiesPanel({ onChanged }: { onChanged: () => void }) {
  const [data, setData] = useState<any>(null);
  const [message, setMessage] = useState<string | null>(null);
  const load = async () => setData(await getJSON('/api/strategies'));
  useEffect(() => { load(); }, []);

  const toggle = async (name: string, enabled: boolean) => {
    await patchJSON(`/api/strategies/${name}`, { enabled });
    await load();
    onChanged();
    setMessage(`${name} ${enabled ? 'enabled' : 'disabled'}`);
  };

  if (!data) return <div className="empty">Loading…</div>;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="row">
        <span style={{ color: 'var(--muted)' }}>
          Strategies share one interface: <code>evaluate(context) → Signal | None</code>.
        </span>
        {message && <span className="pill" style={{ marginLeft: 'auto' }}>{message}</span>}
      </div>
      <div className="card">
        <div className="card-body" style={{ padding: '4px 8px' }}>
          <table className="grid">
            <thead>
              <tr><th>On</th><th>Strategy</th><th>Family</th><th>Requires</th><th>Parameters</th><th>Status</th></tr>
            </thead>
            <tbody>
              {Object.entries(data.strategies || {}).map(([name, meta]: any) => (
                <tr key={name}>
                  <td>
                    <input type="checkbox" aria-label={`Enable ${meta.label || name}`}
                           checked={Boolean(meta.enabled)} onChange={(e) => toggle(name, e.target.checked)} />
                  </td>
                  <td>{meta.label || name}</td>
                  <td>{meta.family}</td>
                  <td className="mono" style={{ fontSize: 10.5 }}>{(meta.requires || []).join(', ')}</td>
                  <td className="mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                    {Object.entries(meta.params || {}).map(([k, v]) => `${k}=${v}`).join(' · ')}
                  </td>
                  <td>
                    {(data.disabled || []).some((d: any) => d.name === name)
                      ? <span className="pill no">{(data.disabled || []).find((d: any) => d.name === name).reason}</span>
                      : <span className="pill ok">active</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------- data
export function DataPanel({ onChanged }: { onChanged: () => void }) {
  const [data, setData] = useState<any>(null);
  const [message, setMessage] = useState<string | null>(null);
  const load = async () => setData(await getJSON('/api/data'));
  useEffect(() => { load(); }, []);

  const reload = async () => {
    setMessage('Reloading provider…');
    const res = await postJSON('/api/data/reload');
    setData(res.info);
    setMessage(`Provider: ${res.provider}`);
    onChanged();
  };

  if (!data) return <div className="empty">Loading…</div>;
  const features = data.health?.capabilities?.features || {};
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="card">
        <div className="card-head"><h3>Active feed</h3>
          <span className={`badge ${data.health?.capabilities?.synthetic ? 'sim' : 'csv'}`} style={{ marginLeft: 'auto' }}>
            {data.provider}
          </span>
        </div>
        <div className="card-body" style={{ display: 'grid', gap: 10 }}>
          <div style={{ color: 'var(--muted)' }}>{data.instructions}</div>
          <div className="kv"><span className="k">CSV folder</span><span className="v mono">{data.csv_dir}</span></div>
          <div className="kv"><span className="k">Available symbols</span><span className="v">{(data.available_symbols || []).join(', ')}</span></div>
          {(data.files || []).length > 0 && (
            <table className="grid">
              <thead><tr><th>File</th><th style={{ textAlign: 'right' }}>Size</th></tr></thead>
              <tbody>
                {data.files.map((f: any) => (
                  <tr key={f.name}><td className="mono" style={{ fontSize: 10.5 }}>{f.name}</td><td className="n">{Math.round(f.size_bytes / 1024)} KB</td></tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="row">
            <button className="btn ghost" onClick={reload}>Reload provider</button>
            {message && <span className="pill">{message}</span>}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>What this feed supports</h3></div>
        <div className="card-body" style={{ padding: '4px 8px' }}>
          <table className="grid">
            <thead><tr><th>Feature</th><th>Available</th><th>Requires</th><th>Reason</th></tr></thead>
            <tbody>
              {Object.entries(features).map(([key, f]: any) => (
                <tr key={key}>
                  <td>{f.label}</td>
                  <td>{f.available ? <span className="pill ok">yes</span> : <span className="pill no">disabled</span>}</td>
                  <td className="mono" style={{ fontSize: 10.5 }}>{(f.requires || []).join(' + ')}</td>
                  <td style={{ color: 'var(--muted)' }}>{f.reason || '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>Other feeds</h3></div>
        <div className="card-body">
          {Object.entries(data.alternatives || {}).map(([key, text]: any) => (
            <div className="kv" key={key}><span className="k mono">{key}</span><span className="v" style={{ fontSize: 10.5, maxWidth: 420, textAlign: 'right' }}>{text}</span></div>
          ))}
        </div>
      </div>
    </div>
  );
}
