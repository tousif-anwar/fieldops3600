"""FastAPI application: data, analysis, signals, backtests, journal, paper mode.

The app never sends orders. Every price it prints is a suggestion for the user
to place manually on their own platform.
"""
from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import Any

import numpy as np
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .analysis import orderflow as of_mod
from .analysis.context import build_context
from .analysis.prep import clear_cache, get_prepared
from .backtest import walkforward as wf
from .backtest.engine import Backtester
from .config import ROOT, Config
from .data.base import quality_report
from .data.frame import TIMEFRAMES, TIMEFRAME_LABELS, normalize_timeframe
from .data.service import MarketDataService
from .db import Database
from .fundamentals.service import DISCLAIMER, FundamentalService
from .instruments import InstrumentBook, contract_label
from .journal import JournalService
from .paper import PaperTrader
from .session import session_bounds
from .signals.engine import evaluate
from .strategies import StrategyRegistry

APP_TITLE = "Trading Decision Support"


# --------------------------------------------------------------------------
# Application state
# --------------------------------------------------------------------------
class AppState:
    def __init__(self) -> None:
        self.cfg = Config()
        self.book = InstrumentBook.from_yaml(self.cfg.markets_yaml)
        self.svc = MarketDataService(self.cfg, self.book)
        self.registry = StrategyRegistry(self.cfg)
        self.fund = FundamentalService(self.cfg.fundamentals)
        self.db = Database(self.cfg.path(self.cfg.data.get("cache_db", "./data/trading.db")))
        self.journal = JournalService(self.db, self.cfg)
        self.paper = PaperTrader(self.svc, self.cfg, self.book, self.registry, self.fund, self.journal)
        self.started_at = int(time.time())

    def reload(self) -> None:
        self.cfg.reload()
        self.book = InstrumentBook.from_yaml(self.cfg.markets_yaml)
        self.svc.cfg = self.cfg
        self.svc.book = self.book
        self.svc.reload()
        self.registry = StrategyRegistry(self.cfg)
        self.fund = FundamentalService(self.cfg.fundamentals)
        self.paper.registry = self.registry
        self.paper.fundamentals = self.fund
        clear_cache()


STATE = AppState()
app = FastAPI(title=APP_TITLE, version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
def _inst(symbol: str):
    try:
        return STATE.book.get(symbol.upper())
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _series(times: np.ndarray, values: np.ndarray, limit: int) -> list[dict]:
    ts = times[-limit:]
    vs = values[-limit:]
    out = []
    for t, v in zip(ts, vs):
        try:
            f = float(v)
        except (TypeError, ValueError):
            continue
        if np.isfinite(f):
            out.append({"time": int(t), "value": round(f, 4)})
    return out


def _orderflow_last(frame, inst, caps) -> dict:
    empty = {
        "available": False, "has_trades": False, "has_depth": False, "delta": None,
        "cumulative_delta": None, "footprint": [], "icebergs": [], "stacked": [],
        "absorption": None,
        "reason": "Order flow requires trade prints and/or depth; this feed supplies candles only.",
    }
    if not (caps.has("trades") or caps.has("depth")):
        return empty
    i = len(frame) - 1
    ts = int(frame.ts[i])
    try:
        trades = STATE.svc.trades(frame.symbol, ts, ts + TIMEFRAMES[frame.timeframe])
    except Exception:
        trades = []
    try:
        depth = STATE.svc.depth_events(frame.symbol, ts, ts + TIMEFRAMES[frame.timeframe])
    except Exception:
        depth = []
    if not trades and not depth:
        return empty
    snap = of_mod.snapshot(frame, i, trades, depth, inst.tick_size)
    # absorption is only meaningful within the bar's own range
    bar_range = max(float(frame.high[i] - frame.low[i]), inst.tick_size)
    atr_val = bar_range
    try:
        snap["absorption"] = of_mod.absorption(
            float(frame.open[i]), float(frame.high[i]), float(frame.low[i]), float(frame.close[i]),
            float(frame.volume[i]), atr_val,
            float(snap.get("rel_volume") or 1.0), snap.get("delta"), inst.tick_size)
    except Exception:
        snap["absorption"] = None
    return snap


def _iceberg_markers(inst, caps, end_ts: int, minutes: int = 120) -> list[dict]:
    if not caps.has("depth"):
        return []
    start = end_ts - minutes * 60
    try:
        events = STATE.svc.depth_events(inst.symbol, start, end_ts)
    except Exception:
        return []
    found = of_mod.icebergs(events, inst.tick_size, min_evidence=3)
    return [{
        "time": int(end_ts), "price": x["price"], "side": x["side"],
        "label": x["label"], "confidence": x["confidence"],
        "evidence_count": x["evidence_count"], "evidence": x["evidence"],
        "fill_multiple": x["fill_multiple"],
    } for x in found[:12]]


def build_analysis(symbol: str, timeframe: str, limit: int = 900) -> dict:
    inst = _inst(symbol)
    tf = normalize_timeframe(timeframe)
    frame = STATE.svc.frame(inst.symbol, tf)
    if len(frame) < 20:
        raise HTTPException(status_code=409, detail=f"not enough candles for {inst.symbol} {tf}")
    caps = STATE.svc.capabilities(inst.symbol)
    prep = get_prepared(frame, inst)
    i = len(frame) - 1
    ts = int(frame.ts[i])
    fund = STATE.fund.pack(inst.symbol, inst.sector, ts)
    orderflow = _orderflow_last(frame, inst, caps)
    ctx = build_context(prep, i, fundamentals=fund, orderflow=orderflow, capabilities=caps)
    result = evaluate(ctx, STATE.registry, STATE.cfg, fund, caps)
    quality = quality_report(frame, tf, float(STATE.cfg.data.get("stale_after_seconds", 180)))
    contract = contract_label(inst)

    n = min(limit, len(frame))
    times = frame.ts[-n:]
    iv = i

    def tail(arr):
        return _series(times, arr[-n:], n)

    def masked_series(arr, keep):
        """Series that carries a value only where `keep` is true and emits a
        time-only point everywhere else. Lightweight Charts treats those as
        whitespace, which breaks the line instead of drawing a diagonal across
        the stretch where the other side was in force."""
        vals = np.asarray(arr)[-n:]
        flags = np.asarray(keep)[-n:]
        out = []
        for t, v, k in zip(times, vals, flags):
            if bool(k) and np.isfinite(v):
                out.append({"time": int(t), "value": round(float(v), 6)})
            else:
                out.append({"time": int(t)})
        return out

    overlays = {
        "ema9": tail(prep.ema9), "ema21": tail(prep.ema21),
        "ema50": tail(prep.ema50), "ema200": tail(prep.ema200),
        "vwap": tail(prep.vwap_data["vwap"]),
        "vwap_upper1": tail(prep.vwap_data["upper1"]),
        "vwap_lower1": tail(prep.vwap_data["lower1"]),
        "vwap_upper2": tail(prep.vwap_data["upper2"]),
        "vwap_lower2": tail(prep.vwap_data["lower2"]),
        "supertrend_up": masked_series(prep.supertrend, prep.supertrend_dir > 0),
        "supertrend_down": masked_series(prep.supertrend, prep.supertrend_dir < 0),
    }

    window_start_ts = int(times[0])
    swing_markers = [{
        "time": int(frame.ts[s.confirmed_index]) if s.confirmed_index < len(frame) else ts,
        "pivot_time": int(frame.ts[s.index]), "price": round(s.price, 6),
        "kind": s.kind, "strength": round(s.strength, 3),
        "label": f"Swing {'high' if s.kind == 'high' else 'low'} {s.price:.2f}",
        "reason": f"Pivot at bar {s.index}, confirmed {s.confirmed_index - s.index} bars later.",
    } for s in prep.swings if int(frame.ts[s.confirmed_index if s.confirmed_index < len(frame) else i]) >= window_start_ts]

    structure_markers = [{
        "time": int(frame.ts[e.index]), "price": round(e.level, 6), "kind": e.kind,
        "direction": e.direction, "label": e.label,
        "reason": f"{e.kind} confirmed on bar {e.index}: close beyond the swing at {e.level:.2f} "
                  f"(swing bar {e.swing_index}).",
    } for e in prep.structure if int(frame.ts[e.index]) >= window_start_ts]

    sweep_markers = []
    for idx, hits in prep.sweeps.items():
        if int(frame.ts[idx]) < window_start_ts:
            continue
        for h in hits:
            sweep_markers.append({
                "time": int(frame.ts[idx]), "price": round(h.level, 6),
                "direction": h.direction, "level_kind": h.level_kind,
                "label": f"Sweep of {h.level_label}",
                "confidence": round(h.confidence, 2), "evidence": h.evidence,
                "reclaimed": h.reclaimed,
            })

    # One profile per trading day, for every session that overlaps the candles
    # being returned. The renderer draws each profile against its own session,
    # so the POC/VAH/VAL it shows belongs to the day it is drawn on.
    volume_profiles = []
    for td, prof in list(prep.profiles.items())[-14:]:
        row = prof.dict()
        if row["end_ts"] < window_start_ts:
            continue
        row["label"] = str(prep.td_dates[td])
        row["trading_day"] = td
        volume_profiles.append(row)

    stored = STATE.journal.recent_signals(inst.symbol, tf, limit=40)
    signal_markers = [{
        "time": int(s["ts"]), "price": float((s["payload"] or {}).get("entry", {}).get("price") or s["payload"]["price_at_signal"]),
        "direction": s["direction"], "score": s["score"], "strategy": s["strategy"],
        "label": f"{s['direction']} {s['strategy']} ({s['score']})",
        "outcome": s["outcome"], "id": s["id"],
        "reason": f"Logged {s['source']} signal, score {s['score']}.",
    } for s in stored if int(s["ts"]) >= window_start_ts]

    shift_markers = []
    for j in range(len(frame) - n, len(frame)):
        if not prep.quantum_shift[j]:
            continue
        up = prep.quantum_shift[j] > 0
        vol_ratio = float(frame.volume[j]) / max(float(np.mean(frame.volume[max(0, j - 19):j + 1])), 1e-9)
        shift_markers.append({
            "time": int(frame.ts[j]), "price": round(float(frame.close[j]), 6),
            "direction": "bull" if up else "bear",
            "score": round(float(prep.quantum_shift_score[j]), 2),
            "label": "Quantum shift up" if up else "Quantum shift down",
            "reason": ((f"Close reclaimed EMA9 in the top 40% of the bar on {vol_ratio:.2f}x average "
                        f"volume, after a down EMA state.") if up else
                       (f"Close lost EMA9 in the bottom 40% of the bar on {vol_ratio:.2f}x average "
                        f"volume, after an up EMA state.")),
        })

    warnings = list(quality.get("warnings", []))
    warnings.append({"level": "info", "code": "closed_bars",
                     "message": "All analysis uses closed bars only; the forming bar is excluded."})
    if not caps.has("trades"):
        warnings.append({"level": "info", "code": "no_ticks",
                         "message": "No tick data: footprint, delta, absorption and iceberg layers are disabled."})
    if (fund.get("providers", {}).get("calendar") or "").startswith("simulated"):
        warnings.append({"level": "info", "code": "sim_fundamentals",
                         "message": "Economic calendar, headlines and cross-asset context are SIMULATED."})

    return {
        "symbol": inst.symbol,
        "name": inst.name,
        "contract": contract,
        "timeframe": tf,
        "timeframe_label": TIMEFRAME_LABELS[tf],
        "spec": inst.spec(),
        "provider": {
            "id": STATE.svc.provider,
            "synthetic": frame.synthetic,
            "delayed": caps.delayed,
            "live": caps.live,
            "capabilities": caps.dict(),
            "available_symbols": STATE.svc.describe()["available_symbols"],
        },
        "server_time": int(time.time()),
        "bar_time": ts,
        "series": {
            "candles": frame.records(n),
            "volume": [{"time": int(t), "value": float(v)} for t, v in zip(times, frame.volume[-n:])],
            "overlays": overlays,
        },
        "markers": {
            "swings": swing_markers[-260:],
            "structure": structure_markers[-160:],
            "sweeps": sweep_markers[-160:],
            "icebergs": _iceberg_markers(inst, caps, ts),
            "signals": signal_markers[-60:],
            "shifts": shift_markers[-50:],
        },
        "context": ctx.to_dict(),
        "volume_profiles": volume_profiles,
        "levels": ctx.levels,
        "session_levels": [lv for lv in ctx.levels if lv["group"] == "session"],
        "zones": ctx.zones,
        "signal": result,
        "fundamentals": fund,
        "quality": quality,
        "warnings": warnings,
        "strategies": {
            "enabled": [{"name": s.name, "label": s.label, "family": s.family,
                         "requires": s.requires} for s in STATE.registry.active(caps)],
            "disabled": STATE.registry.disabled(caps),
            "errors": list(getattr(STATE.registry, "last_errors", []) or []),
        },
        "disclaimer": DISCLAIMER,
    }


# --------------------------------------------------------------------------
# Models
# --------------------------------------------------------------------------
class ConfigPatch(BaseModel):
    patch: dict[str, Any]


class StrategyPatch(BaseModel):
    enabled: bool | None = None
    params: dict[str, Any] | None = None


class BacktestRequest(BaseModel):
    symbol: str = "MNQ"
    timeframe: str = "5m"
    bars: int = Field(default=2500, ge=300, le=20000)
    risk: dict[str, Any] | None = None
    signals: dict[str, Any] | None = None
    include_orderflow: bool = False
    save: bool = True


class WalkForwardRequest(BaseModel):
    symbol: str = "MNQ"
    timeframe: str = "5m"
    bars: int = Field(default=2000, ge=600, le=8000)
    folds: int = Field(default=3, ge=2, le=6)
    train_fraction: float = Field(default=0.7, ge=0.5, le=0.85)
    holdout_fraction: float = Field(default=0.2, ge=0.1, le=0.4)


class JournalCreate(BaseModel):
    signal_id: str | None = None
    signal: dict[str, Any] | None = None
    symbol: str | None = None
    timeframe: str | None = None
    direction: str | None = None
    entry: float | None = None
    stop: float | None = None
    target: float | None = None
    size: int | None = None
    taken: bool = True
    fill_price: float | None = None
    exit_price: float | None = None
    notes: str = ""
    screenshot: str | None = None
    tags: list[str] | None = None


class JournalPatch(BaseModel):
    taken: bool | None = None
    fill_price: float | None = None
    exit_price: float | None = None
    outcome_r: float | None = None
    outcome_dollars: float | None = None
    notes: str | None = None
    screenshot: str | None = None
    size: int | None = None
    stop: float | None = None
    target: float | None = None
    tags: list[str] | None = None


class PaperStart(BaseModel):
    symbol: str = "MNQ"
    timeframe: str = "5m"


# --------------------------------------------------------------------------
# API
# --------------------------------------------------------------------------
@app.get("/api/health")
def health() -> dict:
    return {
        "ok": True,
        "app": APP_TITLE,
        "version": app.version,
        "uptime_seconds": int(time.time()) - STATE.started_at,
        "provider": STATE.svc.provider,
        "data": STATE.svc.health(),
        "db": STATE.db.stats(),
        "paper": STATE.paper.status(),
    }


@app.get("/api/config")
def get_config() -> dict:
    return {
        **STATE.cfg.snapshot(),
        "timeframes": [{"id": k, "label": TIMEFRAME_LABELS[k]} for k in TIMEFRAMES],
        "disclaimer": DISCLAIMER,
    }


@app.patch("/api/config/{section}")
def patch_config(section: str, body: ConfigPatch) -> dict:
    try:
        return STATE.cfg.update_section(section, body.patch)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/config/reset")
def reset_config() -> dict:
    STATE.cfg.reset_overrides()
    STATE.reload()
    return STATE.cfg.snapshot()


@app.get("/api/strategies")
def strategies() -> dict:
    caps = STATE.svc.capabilities("MNQ")
    return {"strategies": STATE.cfg.strategies(),
            "active": [s.name for s in STATE.registry.active(caps)],
            "disabled": STATE.registry.disabled(caps)}


@app.patch("/api/strategies/{name}")
def patch_strategy(name: str, body: StrategyPatch) -> dict:
    try:
        return STATE.cfg.update_strategy(name, body.enabled, body.params)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/markets")
def markets() -> dict:
    return {
        "markets": [{**inst.spec(), **contract_label(inst), "available": STATE.svc.available(inst.symbol)}
                    for inst in STATE.book.all()],
        "provider": STATE.svc.describe(),
    }


@app.get("/api/data")
def data_status() -> dict:
    info = STATE.svc.describe()
    csv_dir = STATE.cfg.path(STATE.cfg.data.get("csv_dir", "./data/csv"))
    files = []
    if csv_dir.exists():
        files = [{"name": p.name, "size_bytes": p.stat().st_size,
                  "modified": int(p.stat().st_mtime)}
                 for p in sorted(csv_dir.iterdir()) if p.suffix.lower() in {".csv", ".txt", ".tsv"}]
    return {**info, "csv_dir": str(csv_dir), "files": files,
            "instructions": ("Drop a NinjaTrader Historical Data Manager export (.txt/.csv) into the csv_dir, "
                             "then set provider 'csv' in config/settings.yaml and reload.")}


@app.post("/api/data/reload")
def data_reload() -> dict:
    try:
        STATE.reload()
        return {"ok": True, "provider": STATE.svc.provider, "info": STATE.svc.describe()}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/candles")
def candles(symbol: str = Query("MNQ"), timeframe: str = Query("5m"),
            limit: int = Query(1500, ge=20, le=20000)) -> dict:
    inst = _inst(symbol)
    tf = normalize_timeframe(timeframe)
    frame = STATE.svc.frame(inst.symbol, tf)
    recs = frame.records(limit)
    return {"symbol": inst.symbol, "timeframe": tf, "count": len(recs), "candles": recs,
            "synthetic": frame.synthetic, "provider": frame.provider,
            "quality": quality_report(frame, tf)}


@app.get("/api/analysis")
def analysis(symbol: str = Query("MNQ"), timeframe: str = Query("5m"),
             limit: int = Query(900, ge=100, le=5000)) -> dict:
    return build_analysis(symbol, timeframe, limit)


@app.get("/api/fundamentals")
def fundamentals(symbol: str = Query("MNQ")) -> dict:
    inst = _inst(symbol)
    frame = STATE.svc.frame(inst.symbol, "5m")
    ts = int(frame.ts[-1]) if len(frame) else int(time.time())
    fund = STATE.fund.pack(inst.symbol, inst.sector, ts)
    return {**fund, "symbol": inst.symbol, "session": session_bounds(ts, inst.sector).dict()}


@app.get("/api/signals")
def signals(symbol: str | None = None, timeframe: str | None = None, limit: int = 50) -> dict:
    return {"signals": STATE.journal.recent_signals(symbol, timeframe, limit)}


@app.post("/api/signals/log")
def log_signal(payload: dict) -> dict:
    signal = payload.get("signal") or payload
    if not signal or "entry" not in signal:
        raise HTTPException(status_code=400, detail="expected a signal card with an 'entry' field")
    sid = STATE.journal.log_signal(signal, source=payload.get("source", "manual"))
    return {"id": sid, "logged": True}


@app.post("/api/backtest")
async def backtest(body: BacktestRequest) -> dict:
    inst = _inst(body.symbol)
    tf = normalize_timeframe(body.timeframe)

    def run() -> dict:
        bt = Backtester(STATE.cfg, STATE.book, STATE.registry, STATE.fund, STATE.svc)
        report = bt.run(inst.symbol, tf, bars=body.bars, risk_overrides=body.risk,
                        signal_overrides=body.signals, include_orderflow=body.include_orderflow)
        if report.get("error"):
            return report
        if body.save:
            report["id"] = STATE.db.save_backtest(report)
        return report

    return await asyncio.to_thread(run)


@app.post("/api/backtest/walkforward")
async def walk_forward(body: WalkForwardRequest) -> dict:
    inst = _inst(body.symbol)
    tf = normalize_timeframe(body.timeframe)

    def run() -> dict:
        return wf.run(STATE.cfg, STATE.book, STATE.registry, STATE.fund, STATE.svc,
                      inst.symbol, tf, bars=body.bars, folds=body.folds,
                      train_fraction=body.train_fraction, holdout_fraction=body.holdout_fraction)

    return await asyncio.to_thread(run)


@app.get("/api/backtests")
def list_backtests(limit: int = 20) -> dict:
    return {"backtests": STATE.db.list_backtests(limit)}


@app.get("/api/journal")
def list_journal(limit: int = 100, symbol: str | None = None, days: int | None = None) -> dict:
    return {"entries": STATE.journal.list_entries(limit=limit, symbol=symbol, days=days)}


@app.post("/api/journal")
def create_journal(body: JournalCreate) -> dict:
    payload = body.model_dump(exclude_none=True)
    entry = STATE.journal.create_entry(payload)
    return {"entry": entry}


@app.patch("/api/journal/{jid}")
def patch_journal(jid: str, body: JournalPatch) -> dict:
    patch = body.model_dump(exclude_none=True)
    entry = STATE.journal.update_entry(jid, patch)
    if entry is None:
        raise HTTPException(status_code=404, detail="journal entry not found")
    return {"entry": entry}


@app.delete("/api/journal/{jid}")
def delete_journal(jid: str) -> dict:
    STATE.db.delete_journal(jid)
    return {"deleted": True}


@app.get("/api/review")
def review(days: int = Query(7, ge=1, le=90)) -> dict:
    return STATE.journal.weekly_review(days=days)


@app.post("/api/paper/start")
async def paper_start(body: PaperStart) -> dict:
    inst = _inst(body.symbol)
    return await STATE.paper.start(inst.symbol, normalize_timeframe(body.timeframe))


@app.post("/api/paper/stop")
async def paper_stop() -> dict:
    return await STATE.paper.stop()


@app.get("/api/paper/status")
def paper_status() -> dict:
    status = STATE.paper.status()
    if STATE.paper.run_id:
        status["stored"] = STATE.db.list_paper_signals(STATE.paper.run_id, limit=100)
    return status


@app.websocket("/ws/stream")
async def stream(ws: WebSocket) -> None:
    await ws.accept()
    symbol = (ws.query_params.get("symbol") or "MNQ").upper()
    timeframe = normalize_timeframe(ws.query_params.get("timeframe") or "5m")
    limit = int(ws.query_params.get("limit") or 600)
    try:
        while True:
            try:
                STATE.svc.advance(symbol, "1m")
                data = await asyncio.to_thread(build_analysis, symbol, timeframe, limit)
                await ws.send_json({"type": "analysis", "data": data})
            except Exception as exc:
                await ws.send_json({"type": "error", "message": str(exc)})
            await asyncio.sleep(5)
    except WebSocketDisconnect:
        return
    except Exception:
        return


# --------------------------------------------------------------------------
# Static frontend
# --------------------------------------------------------------------------
DIST = ROOT / "frontend" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/")
    def index() -> Any:
        return FileResponse(DIST / "index.html")

    @app.get("/{path:path}")
    def spa(path: str) -> Any:
        if path.startswith("api/") or path.startswith("ws/"):
            raise HTTPException(status_code=404, detail="not found")
        candidate = DIST / path
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(DIST / "index.html")
else:
    @app.get("/")
    def placeholder() -> HTMLResponse:
        return HTMLResponse(
            "<h1>Trading Decision Support</h1>"
            "<p>Backend is running. The frontend has not been built yet.</p>"
            "<p>Run <code>cd frontend &amp;&amp; npm install &amp;&amp; npm run build</code>, "
            "or use the Vite dev server on port 5173.</p>"
            "<p><a href='/docs'>API docs</a></p>"
        )
