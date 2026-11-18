import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { etTime, fmt, getJSON, postJSON } from './api';
import Chart from './components/Chart';
import LayerToggles from './components/LayerToggles';
import SignalCard from './components/SignalCard';
import {
  BiasCard, CalendarCard, DetailCard, HeadlinesCard, LevelsCard, WarningsCard,
} from './components/SidePanel';
import {
  BacktestPanel, DataPanel, JournalPanel, PlanPanel, ReviewPanel, StrategiesPanel,
} from './components/panels';
import { DEFAULT_LAYERS, type Analysis, type Detail, type Layers, type Market } from './types';

const TABS = [
  { id: 'backtest', label: 'Backtest & validation' },
  { id: 'journal', label: 'Trade journal' },
  { id: 'review', label: 'Weekly review' },
  { id: 'strategies', label: 'Strategies' },
  { id: 'plan', label: 'Risk plan' },
  { id: 'data', label: 'Data & providers' },
];

export default function App() {
  const [config, setConfig] = useState<any>(null);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [symbol, setSymbol] = useState('MNQ');
  const [timeframe, setTimeframe] = useState('5m');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [layers, setLayers] = useState<Layers>(DEFAULT_LAYERS);
  const [live, setLive] = useState(false);
  const [tab, setTab] = useState('backtest');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [logging, setLogging] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  // ------------------------------------------------------------------ config
  useEffect(() => {
    (async () => {
      try {
        const [cfg, mk] = await Promise.all([getJSON('/api/config'), getJSON('/api/markets')]);
        setConfig(cfg);
        setMarkets(mk.markets || []);
      } catch (e: any) {
        setError(e.message);
      }
    })();
  }, []);

  // ------------------------------------------------------------------- data
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const data = await getJSON(`/api/analysis?symbol=${symbol}&timeframe=${timeframe}&limit=900`);
        if (!cancelled) {
          setAnalysis(data);
          setUpdatedAt(Date.now());
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [symbol, timeframe, refreshKey]);

  // ------------------------------------------------------------------- live
  useEffect(() => {
    if (!live) return;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/ws/stream?symbol=${symbol}&timeframe=${timeframe}&limit=900`);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'analysis') {
          setAnalysis(msg.data);
          setUpdatedAt(Date.now());
        }
      } catch {
        /* ignore malformed frame */
      }
    };
    ws.onerror = () => setToast('Live stream unavailable. Is the backend running?');
    return () => ws.close();
  }, [live, symbol, timeframe]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const logSignal = useCallback(async (card: any) => {
    setLogging(true);
    try {
      await postJSON('/api/signals/log', { signal: card, source: 'ui' });
      setToast('Signal logged to the journal.');
      setTab('journal');
    } catch (e: any) {
      setToast(`Could not log: ${e.message}`);
    } finally {
      setLogging(false);
    }
  }, []);

  // roving tabindex across the panel tabs, per the ARIA tabs pattern
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const index = TABS.findIndex((t) => t.id === tab);
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const next = e.key === 'Home'
      ? TABS[0]
      : e.key === 'End'
        ? TABS[TABS.length - 1]
        : TABS[(index + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length];
    setTab(next.id);
    requestAnimationFrame(() => document.getElementById(`tab-${next.id}`)?.focus());
  };

  const lastBar = analysis?.series?.candles?.[analysis.series.candles.length - 1];
  const prevBar = analysis?.series?.candles?.[analysis.series.candles.length - 2];
  const change = lastBar && prevBar ? lastBar.close - prevBar.close : 0;
  const changePct = lastBar && prevBar && prevBar.close ? (change / prevBar.close) * 100 : 0;
  const contract = analysis?.contract || {};
  const caps = analysis?.provider?.capabilities || {};

  const providerBadge = useMemo(() => {
    if (!analysis) return { cls: 'sim', text: 'loading' };
    if (analysis.provider.synthetic) return { cls: 'sim', text: 'simulated feed' };
    if (analysis.provider.id === 'csv') return { cls: 'csv', text: 'csv import' };
    if (analysis.provider.delayed) return { cls: 'delayed', text: 'delayed data' };
    return { cls: 'live', text: 'live feed' };
  }, [analysis]);

  return (
    <div className="app">
      <a className="skip-link" href="#decision">Skip to the current decision</a>

      <header className="topbar">
        <div className="brand">
          <div className="glyph" aria-hidden="true">▮</div>
          <div>
            Trading Decision Support
            <small>CME futures · America/New_York</small>
          </div>
        </div>

        <div className="spacer" />

        <div className="field">
          <label htmlFor="market-select">Market</label>
          <select id="market-select" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            {(markets.length ? markets : [{ symbol: 'MNQ', name: 'Micro Nasdaq', code: 'MNQ' } as any]).map((m) => (
              <option key={m.symbol} value={m.symbol}>
                {m.symbol} · {m.name}
              </option>
            ))}
          </select>
        </div>

        <div className="tf-group" role="group" aria-label="Chart timeframe">
          {(config?.timeframes || [{ id: '5m' }, { id: '15m' }, { id: '1h' }, { id: '1d' }]).map((t: any) => (
            <button
              key={t.id}
              className={timeframe === t.id ? 'active' : ''}
              onClick={() => setTimeframe(t.id)}
              aria-pressed={timeframe === t.id}
            >
              {t.id}
            </button>
          ))}
        </div>

        <span className={`badge dot ${providerBadge.cls}`}>{providerBadge.text}</span>
        <span className="badge mono">{contract.code || '–'}</span>

        <button
          className={`icon-btn ${live ? 'on' : ''}`}
          onClick={() => setLive((v) => !v)}
          title="Follow the feed"
          aria-pressed={live}
          aria-label="Live updates"
        >
          {live ? '◉ Live' : '○ Live'}
        </button>
        <button
          className="icon-btn"
          onClick={refresh}
          title="Recompute from the latest closed bar"
          aria-label="Refresh from the last closed bar"
        >
          ↻
        </button>
        <button
          className="icon-btn"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title="Toggle theme"
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </header>

      <div role="status" aria-live="polite" style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 80 }}>
        {toast && <div className="alert info" style={{ marginBottom: 0, boxShadow: 'var(--float)' }}>{toast}</div>}
      </div>

      <main className="workspace">
        <section className="chart-col" aria-label="Price chart">
          <div className="card">
            <div className="chart-hud">
              <div className="price">{fmt(lastBar?.close, 2)}</div>
              <div className={`chg ${change >= 0 ? 'up' : 'down'}`}>
                {change >= 0 ? '▲' : '▼'} {fmt(Math.abs(change), 2)} ({fmt(Math.abs(changePct), 2)}%)
              </div>
              <div className="sep" aria-hidden="true" />
              <div className="meta">
                {analysis?.name || '–'} · {analysis?.timeframe_label} · {lastBar ? `${etTime(lastBar.time, true)} ET` : ''}
              </div>
              <div className="sep" aria-hidden="true" />
              <div className="meta mono" title="ATR, RSI, ADX, Bollinger bandwidth percentile, variance ratio">
                ATR {fmt(analysis?.context?.indicators?.atr, 2)} · RSI {fmt(analysis?.context?.indicators?.rsi, 1)} ·{' '}
                ADX {fmt(analysis?.context?.indicators?.adx, 1)} · BBW{' '}
                {fmt(analysis?.context?.indicators?.bb_width_rank, 0)} · VR{' '}
                {fmt(analysis?.context?.indicators?.variance_ratio, 2)}
              </div>
              <div
                className="sep"
                aria-hidden="true"
              />
              <div className="meta mono" title="Stochastic RSI (14,3), 14-day average daily range, and how much of it this session has travelled">
                Stoch {fmt(analysis?.context?.indicators?.stoch_rsi, 0)} · ADR{' '}
                {fmt(analysis?.context?.session_range?.average_daily_range, 0)} · used{' '}
                {fmt(analysis?.context?.session_range?.adr_used_pct, 0)}%
              </div>
              <div className="spacer" />
              <div className="meta">
                {analysis?.context?.structure?.state?.replace(/_/g, ' ') || '–'} ·{' '}
                {analysis?.context?.session?.phase || '–'} · score {analysis?.signal?.best_score ?? '–'}
              </div>
            </div>
            <div style={{ position: 'relative' }}>
              <LayerToggles layers={layers} onChange={setLayers} capabilities={caps} />
              {analysis ? (
                <Chart analysis={analysis} layers={layers} theme={theme} onSelect={setDetail} />
              ) : (
                <div className="chart-host" style={{ display: 'grid', placeItems: 'center' }}>
                  {loading ? <div className="spinner" /> : <div className="empty">{error || 'No data'}</div>}
                </div>
              )}
            </div>
            <div className="legend">
              <span><i aria-hidden="true" style={{ background: '#f0a422' }} /> entry</span>
              <span><i aria-hidden="true" style={{ background: '#f2556d' }} /> stop</span>
              <span><i aria-hidden="true" style={{ background: '#34c46f' }} /> targets</span>
              <span><i aria-hidden="true" style={{ background: '#22d3ee' }} /> VWAP</span>
              <span><i aria-hidden="true" style={{ background: '#dcae3c' }} /> value area</span>
              <span><i aria-hidden="true" style={{ background: '#a78bfa' }} /> iceberg?</span>
              <span><i aria-hidden="true" style={{ background: '#e879f9' }} /> sweep</span>
              <span><i aria-hidden="true" style={{ background: 'rgba(240,164,34,0.55)' }} /> volume profile</span>
              <span><i aria-hidden="true" style={{ background: 'rgba(52,196,111,0.7)', borderRadius: '50%' }} /> volume bubbles</span>
              <span style={{ marginLeft: 'auto', color: 'var(--faint)' }}>
                click a line or marker for its reason
                {updatedAt ? ` · updated ${new Date(updatedAt).toLocaleTimeString('en-US', { hour12: false })}` : ''}
              </span>
            </div>
          </div>

          {error && <div className="alert error" role="alert" style={{ marginBottom: 0 }}>{error}</div>}

          <section className="bottom" aria-label="Analysis panels">
            <div className="tabs" role="tablist" aria-label="Analysis panels" onKeyDown={onTabKey}>
              {TABS.map((t) => (
                <button
                  key={t.id}
                  id={`tab-${t.id}`}
                  role="tab"
                  className={tab === t.id ? 'active' : ''}
                  aria-selected={tab === t.id}
                  aria-controls={`panel-${t.id}`}
                  tabIndex={tab === t.id ? 0 : -1}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div
              className="panel"
              id={`panel-${tab}`}
              role="tabpanel"
              aria-labelledby={`tab-${tab}`}
              tabIndex={0}
            >
              {analysis ? (
                <>
                  {tab === 'backtest' && <BacktestPanel analysis={analysis} onRefresh={refresh} />}
                  {tab === 'journal' && <JournalPanel analysis={analysis} onChanged={refresh} />}
                  {tab === 'review' && <ReviewPanel />}
                  {tab === 'strategies' && <StrategiesPanel onChanged={refresh} />}
                  {tab === 'plan' && <PlanPanel config={config} onSaved={() => { refresh(); getJSON('/api/config').then(setConfig); }} />}
                  {tab === 'data' && <DataPanel onChanged={() => { refresh(); getJSON('/api/config').then(setConfig); }} />}
                </>
              ) : (
                <div className="empty">Waiting for the backend…</div>
              )}
            </div>
          </section>
        </section>

        <aside
          className="sidebar"
          id="decision"
          tabIndex={-1}
          aria-label="Current decision and market context"
        >
          {analysis ? (
            <>
              <SignalCard analysis={analysis} onLog={logSignal} logging={logging} />
              <BiasCard analysis={analysis} />
              <DetailCard detail={detail} onClose={() => setDetail(null)} />
              <LevelsCard analysis={analysis} />
              <CalendarCard analysis={analysis} />
              <HeadlinesCard analysis={analysis} />
              <WarningsCard analysis={analysis} />
            </>
          ) : (
            <div className="card"><div className="card-body"><div className="spinner" /></div></div>
          )}
        </aside>
      </main>
    </div>
  );
}
