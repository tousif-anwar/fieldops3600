# Trading Decision Support — CME futures

A local, web-based **decision-support** terminal for CME futures (MNQ, MES, NQ, ES
out of the box, plus CL, GC, ZC — all configurable). It analyses candles,
structure, volume profile, VWAP, order flow and fundamentals, then produces
**explainable signal cards** with exact entry, stop, targets, size and dollar
risk, plotted on a live chart.

> **It never sends orders.** You place every order manually on your own platform
> (NinjaTrader copy tickets are generated). Futures trading carries a substantial
> risk of loss. This is tooling, not financial advice.

---

## What it does

| Layer | Detail |
| --- | --- |
| **Data** | Adapter interface with a deterministic simulated feed, NinjaTrader/generic CSV import, opt-in Yahoo delayed feed, and documented stubs for Databento / Rithmic / CQG / Tradovate. Capabilities are declared per feed, so features that need tick or depth data switch off instead of being faked. |
| **Structure** | Swing pivots (confirmed only after `right` bars), HH/HL/LH/LL state, BOS and CHoCH. |
| **Levels** | Prior day/week/month H/L/C, floor pivots (PP, R1-R3, S1-S3), overnight high/low, opening range, round numbers, swing zones, order blocks, POC/VAH/VAL (session, prior session, composite), naked POCs, HVN/LVN. |
| **Indicators** | EMA 9/21/50/200, VWAP with 1σ/2σ bands, RSI, Stochastic RSI, MACD, ADX with ±DI, ATR, Bollinger bandwidth percentile, Donchian channel, SuperTrend, AR(1) half-life, variance ratio, average daily range with the fraction already used, and the quantum-shift detector. |
| **Volume / flow** | Session and anchored VWAP with 1σ/2σ bands; a volume profile per session, drawn against its own session with POC/VAH/VAL colouring; a volume bubble map that splits each bar's volume across its price range; footprint, delta, cumulative delta, absorption, stacked imbalances and probable-iceberg detection *(tick/depth feeds only)*. |
| **Patterns & sweeps** | Engulfing, pin/hammer, shooting star, doji, inside bar, morning/evening star — upgraded only at a level with volume confirmation. Stop-run (liquidity sweep) detection with penetration, reclaim and volume evidence. |
| **Regime** | ATR percentile, ADX + efficiency ratio, trending/ranging classification that gates which strategy families are allowed. |
| **Fundamentals** | Economic calendar with release windows, headline feed with sentiment, VIX / 10Y / DXY / sector context, megacap earnings, EIA and WASDE for commodities. Produces a Bullish/Neutral/Bearish **bias used only as a filter**, never as an entry. |
| **Signals** | Confluence score 0–100 from weighted factors, plus a full breakdown. Cards include entry (limit *and* stop-entry alternatives), stop with its reason, T1/T2/T3, R:R, size, risk/reward in dollars, invalidation, expiry and a plan checklist. “No trade” is a first-class output with the reason. |
| **Risk** | Contract-accurate sizing (`MNQ $2/pt, NQ $20/pt, MES $5/pt, ES $50/pt`), tick rounding, buying-power cap, user-editable margins, daily loss / trade count / loss-streak locks, and the **binding constraint** on every card. |
| **Backtesting** | Event-driven replay through the *same* context + evaluate path as live. Commissions, entry/stop slippage, partial fills (liquidity proxy), stop-run fills, conservative intrabar ordering. Metrics per strategy, session, regime and weekday; walk-forward with a strictly untouched hold-out; sample-size and overfitting warnings. |
| **Journal** | Every signal logged, taken/skipped, your own fill and exit prices, R and dollars, notes, chart screenshot path, automatic rule-break detection, and a weekly review. |
| **Paper mode** | Streams signals live, logs them, tracks hypothetical outcomes. No money, no orders. |

---

## Quick start (local)

Requirements: Python 3.11+, Node 18+.

```bash
# backend
python -m venv .venv
.venv/Scripts/pip install -r backend/requirements.txt     # Windows
# source .venv/bin/activate && pip install -r backend/requirements.txt   # macOS/Linux

# frontend (build once; FastAPI then serves it)
cd frontend && npm install && npm run build && cd ..

# run
cd backend && ../.venv/Scripts/python -m uvicorn app.main:app --port 8000
```

Open <http://127.0.0.1:8000>. API docs at <http://127.0.0.1:8000/docs>.

Frontend development with hot reload:

```bash
cd frontend && npm run dev     # http://127.0.0.1:5173 (proxies /api and /ws to :8000)
```

### Docker

```bash
docker compose up --build
# http://127.0.0.1:8000
```

`./data` and `./config` are mounted so your journal, cache and settings persist.

---

## Getting data for free

Three honest options ship with the app:

### 1. Simulated feed (default, zero setup)

Deterministic per symbol: 40 Globex sessions of 1-minute bars, resampled to every
intraday timeframe, plus a 900-day daily series. Synthetic tick prints and depth
refresh events are generated too, so footprint/delta/absorption/iceberg layers
are demonstrable. **Everything is labelled as simulated and every warning panel
says so.** A random-walk market has no exploitable edge, so a backtest on it will
look mediocre — that is the honest result, not a bug.

### 2. NinjaTrader CSV export (free real data — best option for you)

1. NinjaTrader → **Control Center → Tools → Historical Data Manager → Export**
2. Pick the instrument (e.g. `MNQ 12-26`) and the minute series, export `.txt`/`.csv`
3. Drop the file in `data/csv/` — name it with the symbol, e.g. `MNQ_1m.csv`
4. In `config/settings.yaml`: `data.provider: csv`, then **Data & providers → Reload provider**

The importer auto-detects NinjaTrader's `yyyyMMdd HHmmss;open;high;low;close;volume`
layout, generic header layouts (`time,open,high,low,close,volume`) and trade
files (`time,price,size,side` → aggregated into bars with buy/sell volume).
Timestamps are interpreted in `America/New_York`.

### 3. Yahoo Finance (free, delayed)

```bash
.venv/Scripts/pip install yfinance
```
Set `data.yahoo.enabled: true`, `data.provider: yahoo`, then reload. `NQ=F`,
`ES=F`, `MNQ=F`, `MES=F` are pre-mapped. Limits: ~7 days of 1m, ~60 days of
5m/15m/30m, delayed, no tick/depth (order-flow layers stay disabled).

Real tick + market-by-order depth needs a paid feed (Databento has a free credit).
`backend/app/data/stubs.py` documents exactly what each vendor requires.

---

## Configuration

| File | Purpose |
| --- | --- |
| `config/settings.yaml` | data provider, risk defaults, signal thresholds, backtest costs, paper mode |
| `config/markets.yaml` | market list, dollar-per-point, tick size, margin, sector, simulated price profile |
| `config/strategies.yaml` | strategy toggles and parameters |

Risk, signal and strategy settings are editable from the UI and persisted to
`data/runtime_overrides.json` (YAML stays untouched). Data-provider changes need
a reload/restart.

Contract codes roll automatically (`MNQZ6`, expiry shown in the header), and all
prices are rounded to the instrument's tick.

---

## Strategies

Each module implements one interface and is independently toggleable:

```python
class Strategy:
    def evaluate(self, ctx: Context) -> SignalCandidate | None: ...
```

| Module | Family | Requires | Idea |
| --- | --- | --- | --- |
| `trend_pullback` | momentum | candles | With structure, buy/sell a pullback into VWAP / EMA21 / POC |
| `sweep_reversal` | contra-trend | candles | Stop run through a level, then reclaim → reversal |
| `value_rotation` | contra-trend | candles | Re-entry into the value area, fade back to POC |
| `opening_range_breakout` | momentum | candles | OR break with a retest entry |
| `absorption_reversal` | contra-trend | **trades + depth** | Absorption / probable iceberg at a defended level |
| `squeeze_expansion` | momentum | candles | Bandwidth squeeze, then a Donchian break on volume |
| `vwap_mean_reversion` | contra-trend | candles | 2sd VWAP fade, gated by the measured half-life |

Adding one: create `backend/app/strategies/my_strategy.py` subclassing `Strategy`,
register it in `backend/app/strategies/__init__.py`, then add an entry in
`config/strategies.yaml`. The registry gates it by `requires`, the scorer weights
its factors, the backtester replays it, and the UI lists it automatically.

---

## Backtesting & validation

* Event-driven: signals are evaluated on a closed bar and can only fill on a
  **later** bar. Same `build_context` → `evaluate` path as live.
* Costs: commission per contract per side, entry slippage, stop slippage, partial
  fills capped by a per-bar liquidity proxy, stop-run fills at the worse price.
  If a bar touches both stop and target, **the stop wins**.
* Metrics: win rate, expectancy in R, profit factor, max drawdown ($ / % / R),
  average win/loss, trade count, hold time, and breakdowns by strategy, session,
  regime, weekday, direction and exit reason.
* **Walk-forward**: parameters chosen on each fold's in-sample window only; the
  reported numbers come from the untouched out-of-sample folds; the final
  hold-out tail is evaluated once and never tuned on. Degradation between IS and
  OOS is reported explicitly.
* Warnings fire on small samples (<30 trades), a t-statistic below 2, and
  IS→OOS degradation.

### Look-ahead tests

`backend/tests/test_no_lookahead.py` is the proof, not a promise:

1. Analysis for bar *i* is built twice — from full history and from history
   **truncated at *i*** — and must be byte-identical (levels, structure, sweeps,
   patterns, profiles, regime, VWAP, zones, indicators).
2. Signals (direction, score, entry, stop, targets) must be identical with and
   without future bars.
3. Swing points must not appear before their confirmation bar.
4. Every signal's `created_ts` equals the bar it was generated on.
5. A backtest must reproduce the same trade hash on a re-run.

```bash
cd backend && ../.venv/Scripts/python -m pytest -q
```

---

## API surface

| Endpoint | Purpose |
| --- | --- |
| `GET /api/analysis?symbol&timeframe&limit` | chart series, overlays, markers, levels, context, signal, bias, warnings |
| `GET /api/candles` | OHLCV + data-quality report |
| `GET /api/markets`, `GET /api/config`, `PATCH /api/config/{section}` | instruments, settings, risk edits |
| `GET/PATCH /api/strategies` | toggles and parameters |
| `POST /api/backtest` | event-driven backtest |
| `POST /api/backtest/walkforward` | walk-forward + hold-out |
| `GET/POST/PATCH /api/journal`, `GET /api/review` | journal and weekly review |
| `POST /api/paper/start|stop`, `GET /api/paper/status` | paper mode |
| `GET /api/data`, `POST /api/data/reload` | provider status, CSV files, reload |
| `WS /ws/stream?symbol&timeframe` | push updates every 5 s |

---

## Copy style

Interface text is audited with the vendored [`skills/unslop`](skills/unslop) scanners before it
ships. `tools/audit_ui_copy.py` collects every user-facing string from the TSX components and
the API messages, then the scanners read that dump:

```bash
python tools/audit_ui_copy.py
python skills/unslop/scripts/banned_phrase_scan.py < data/tmp/ui-copy.txt
python skills/unslop/scripts/structure_scan.py     < data/tmp/ui-copy.txt
```

Current state: zero banned phrases, zero prose em dashes (`em_dash_per_1k: 0.0`). The scanners
suggest candidates only, so check each hit in context. Numbers, thresholds and the risk wording
are content, not style, and must survive any rewrite.

## Design & UX skills

`skills/awesome-ux/` vendors the [awesome-ux-skills](https://github.com/tommyjepsen/awesome-ux-skills)
collection as `skills/<name>/SKILL.md`, so the rules travel with the repo. The interface was audited
with `craft`, `ux-heuristics-review` and `cognitive-load-conversion`. What that changed lives in
`frontend/src/styles.css`:

- one 4px spacing scale, one six-step type scale, one neutral ramp (no one-off values)
- flat color: no gradients, no glow; emphasis comes from weight, size and space
- one elevation language: hairline borders for structure, shadow only on surfaces that float
- designed `hover`, `active`, `disabled` and `:focus-visible` states, plus a real
  `prefers-reduced-motion` branch
- the chart opens on the last 160 bars and only recent markers carry text, so the candles stay
  readable instead of turning into label soup

## Trading skills

`skills/agiprolabs/` vendors the [claude-trading-skills](https://github.com/agiprolabs/claude-trading-skills)
collection, keeping only the parts that speak to listed CME futures: `custom-indicators`,
`strategy-framework`, `mean-reversion`, `exit-strategies`, `regime-detection`,
`signal-classification`, `walk-forward-validation` and `market-microstructure-traditional`. The
on-chain and DEX material in that repo does not apply here and was left out.

What that changed:

- **New indicators** in `backend/app/analysis/indicators.py`: Bollinger bands with a ranked
  bandwidth (squeeze detection), a shifted Donchian channel (a breakout is measured against prior
  bars only), AR(1) half-life, Lo-MacKinlay variance ratio, and a candle-implied delta proxy for
  feeds without ticks.
- **Regime carries persistence**: the variance ratio decides the family switch when ADX and
  efficiency call the regime transitional, which is where those two measures tend to disagree.
- **Regime and family reweighting of the confluence score**: trend factors gain weight in a trend,
  location and candlestick confirmation gain weight in a range, and a counter-trend fade is not
  scored on trend alignment at all.
- **Two new strategies**: `squeeze_expansion` (compressed bandwidth, then a channel break with
  volume) and `vwap_mean_reversion` (a 2sd fade from VWAP, skipped unless the measured half-life
  says the stretch reverts quickly enough).
- **Targets start at the configured minimum reward:risk**, so a structural level inside the minimum
  can no longer become a first target that the engine rejects.

The half-life and variance-ratio thresholds were calibrated against the bars in this repo, not
against a live market. Re-check them on your own NinjaTrader export before trusting the fade.

**On Quantum Shift.** "Quantum Shift" is a closed-source, invite-only TradingView script (MOT) and
there is no published formula to port. `indicators.quantum_shift` is an independent implementation
of the mechanism its public description states: an EMA trend state plus a volume-triggered reversal
candle that reclaims or loses the fast EMA. It is not the vendor script, it produces different
signals, and nothing here should be read as reproducing its results.

## Honest limitations

* **Simulated data has no edge.** Backtests on it exist to prove the machinery,
  not to promise profits. Swap in your NinjaTrader export before drawing any
  conclusion.
* Candle-only feeds cannot produce intrabar volume-at-price. The profile spreads
  each bar's volume across its high-low range, and the bubble map does the same,
  so both are candle-range approximations and say so in the payload. Real
  footprint data would replace them, not sit beside them.
* Iceberg, absorption and sweep detection are **heuristics with evidence
  counts**, never certainties.
* Yahoo data is delayed with short intraday history; it is badged as delayed.
* Backtest fills are modelled, not observed. Real fills will differ.
* One position per market at a time; no pyramiding, no bracket-order management
  beyond the configured scale-out plan.
* The journal's screenshots are a path field — attach your own chart image files.

## Disclaimer

Futures trading involves substantial risk of loss and is not suitable for every
investor. This application is decision-support and educational tooling. It is not
financial advice, it does not place orders, and past or simulated performance is
not indicative of future results.
