"""Paper-trading mode: run live signals, log them, track outcomes. No orders."""
from __future__ import annotations

import asyncio
import time
import uuid
from datetime import datetime

from .analysis.context import build_context
from .analysis.prep import get_prepared
from .session import ET
from .signals.engine import evaluate


class PaperTrader:
    def __init__(self, svc, cfg, book, registry, fundamentals, journal) -> None:
        self.svc = svc
        self.cfg = cfg
        self.book = book
        self.registry = registry
        self.fundamentals = fundamentals
        self.journal = journal
        self.running = False
        self.run_id: str | None = None
        self.symbol = "MNQ"
        self.timeframe = "5m"
        self.started_at: int | None = None
        self.last_bar_ts: int | None = None
        self.equity = float(cfg.paper.get("starting_equity", 25000))
        self.signals: list[dict] = []
        self.tracked: list[dict] = []
        self._task: asyncio.Task | None = None
        self._listeners: list = []
        self.log: list[dict] = []

    # -------------------------------------------------------------- lifecycle
    def add_listener(self, fn) -> None:
        self._listeners.append(fn)

    def _emit(self, kind: str, payload: dict) -> None:
        for fn in list(self._listeners):
            try:
                fn({"type": kind, "payload": payload})
            except Exception:
                pass

    async def start(self, symbol: str, timeframe: str) -> dict:
        if self.running:
            return self.status()
        inst = self.book.get(symbol.upper())
        self.symbol = inst.symbol
        self.timeframe = timeframe
        self.run_id = uuid.uuid4().hex[:12]
        self.started_at = int(time.time())
        self.signals = []
        self.tracked = []
        self.log = []
        self.running = True
        self.journal.db.save_run(self.run_id, "paper", self.symbol, self.timeframe, {
            "started_at": self.started_at, "starting_equity": self.equity,
        })
        self._task = asyncio.create_task(self._loop())
        return self.status()

    async def stop(self) -> dict:
        self.running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
            self._task = None
        if self.run_id:
            self.journal.db.save_run(self.run_id, "paper", self.symbol, self.timeframe, {
                "started_at": self.started_at, "stopped_at": int(time.time()),
                "signals": len(self.signals),
            }, stopped_at=int(time.time()))
        return self.status()

    async def _loop(self) -> None:
        interval = max(2, int(self.cfg.paper.get("poll_seconds", 5)))
        while self.running:
            try:
                await asyncio.to_thread(self.tick)
            except Exception as exc:
                self.log.append({"ts": int(time.time()), "error": str(exc)})
            await asyncio.sleep(interval)

    # ------------------------------------------------------------------- tick
    def tick(self) -> dict:
        """One paper iteration: advance the feed, evaluate, log, track outcomes."""
        self.svc.advance(self.symbol, "1m")
        frame = self.svc.frame(self.symbol, self.timeframe)
        if len(frame) == 0:
            return self.status()
        last_ts = int(frame.ts[-1])
        inst = self.book.get(self.symbol)
        prep = get_prepared(frame, inst)
        i = len(frame) - 1
        funds = self.fundamentals.pack(self.symbol, inst.sector, last_ts)
        ctx = build_context(prep, i, fundamentals=funds,
                            orderflow=self._orderflow(frame, i, inst, last_ts),
                            capabilities=self.svc.capabilities(self.symbol))
        state = {
            "trades_today": len([s for s in self.tracked if s["status"] == "filled"]),
            "pnl_today": self._today_pnl(),
            "consecutive_losses": self._loss_streak(),
            "locked": False,
        }
        result = evaluate(ctx, self.registry, self.cfg, funds,
                          self.svc.capabilities(self.symbol), state)

        is_new_bar = self.last_bar_ts is None or last_ts > self.last_bar_ts
        if is_new_bar:
            self.last_bar_ts = last_ts
            if result["state"] == "signal":
                card = result["signal"]
                sid = self.journal.log_signal(card, source="paper")
                record = {
                    "id": sid, "run_id": self.run_id, "ts": last_ts,
                    "status": "pending", "outcome": None, "outcome_r": None,
                    "card": card, "logged_at": int(time.time()),
                }
                self.journal.db.save_paper_signal(self.run_id, sid, last_ts, card)
                self.signals.append(card)
                self.tracked.append(record)
                self._emit("paper_signal", {"signal": card, "status": "pending"})
            else:
                self._emit("paper_no_trade", {"reasons": result.get("reasons", [])})
        self._track(frame, inst)
        self._emit("paper_status", self.status())
        return self.status()

    def _orderflow(self, frame, i: int, inst, ts: int) -> dict:
        from .analysis import orderflow as of_mod

        step = 60
        try:
            trades = self.svc.trades(self.symbol, ts, ts + step)
        except Exception:
            trades = []
        try:
            depth = self.svc.depth_events(self.symbol, ts, ts + step)
        except Exception:
            depth = []
        if not trades and not depth:
            return {
                "available": False, "has_trades": False, "has_depth": False, "delta": None,
                "cumulative_delta": None, "footprint": [], "icebergs": [], "stacked": [],
                "absorption": None,
                "reason": "Order flow requires tick or depth data; this feed provides candles only.",
            }
        snap = of_mod.snapshot(frame, i, trades, depth, inst.tick_size)
        snap["absorption"] = of_mod.absorption(
            float(frame.open[i]), float(frame.high[i]), float(frame.low[i]), float(frame.close[i]),
            float(frame.volume[i]), float(frame.high[i] - frame.low[i]) or inst.tick_size,
            float(snap.get("rel_volume") or 1.0), snap.get("delta"), inst.tick_size)
        return snap

    def _track(self, frame, inst) -> None:
        """Conservative outcome tracking: stop before target, fills only after the signal bar."""
        for rec in self.tracked:
            if rec["status"] in {"stopped", "target", "expired", "closed"}:
                continue
            card = rec["card"]
            entry = float(card["entry"]["price"])
            stop = float(card["stop"]["price"])
            target = float(card["targets"][0]["price"])
            sign = 1 if card["direction"] == "long" else -1
            after = [(int(t), float(h), float(l), float(c))
                     for t, h, l, c in zip(frame.ts, frame.high, frame.low, frame.close)
                     if int(t) > rec["ts"]]
            fill_price = None
            for ts, h, l, c in after:
                if rec["status"] == "pending":
                    touched = (l <= entry) if sign > 0 else (h >= entry)
                    if touched:
                        rec["status"] = "filled"
                        rec["filled_ts"] = ts
                        fill_price = entry
                    elif ts > int(card.get("expires_ts", rec["ts"])):
                        rec["status"] = "expired"
                        self.journal.db.update_paper_signal(rec["id"], "expired", None)
                        break
                if rec["status"] == "filled":
                    if (l <= stop) if sign > 0 else (h >= stop):
                        rec["status"] = "stopped"
                        rec["outcome_r"] = -1.0
                        self.journal.db.update_paper_signal(rec["id"], "stopped", -1.0)
                        self.journal.db.update_signal_outcome(rec["id"], "stopped", -1.0)
                        break
                    if (h >= target) if sign > 0 else (l <= target):
                        rr = abs(target - entry) / max(abs(entry - stop), 1e-9)
                        rec["status"] = "target"
                        rec["outcome_r"] = round(rr, 2)
                        self.journal.db.update_paper_signal(rec["id"], "target", round(rr, 2))
                        self.journal.db.update_signal_outcome(rec["id"], "target", round(rr, 2))
                        break

    def _today_pnl(self) -> float:
        today = datetime.now(ET).date()
        total = 0.0
        for rec in self.tracked:
            if rec.get("outcome_r") is None:
                continue
            if datetime.fromtimestamp(rec["ts"], ET).date() != today:
                continue
            risk = float(rec["card"]["size"].get("risk_dollars") or 0)
            total += float(rec["outcome_r"]) * risk
        return total

    def _loss_streak(self) -> int:
        streak = 0
        for rec in reversed(self.tracked):
            if rec.get("outcome_r") is None:
                continue
            if float(rec["outcome_r"]) <= 0:
                streak += 1
            else:
                break
        return streak

    # ------------------------------------------------------------------ state
    def status(self) -> dict:
        filled = [r for r in self.tracked if r["status"] == "filled"]
        closed = [r for r in self.tracked if r.get("outcome_r") is not None]
        wins = [r for r in closed if float(r["outcome_r"]) > 0]
        return {
            "running": self.running,
            "run_id": self.run_id,
            "symbol": self.symbol,
            "timeframe": self.timeframe,
            "started_at": self.started_at,
            "last_bar_ts": self.last_bar_ts,
            "signals_logged": len(self.signals),
            "pending": len([r for r in self.tracked if r["status"] == "pending"]),
            "filled": len(filled),
            "closed": len(closed),
            "win_rate": round(100 * len(wins) / len(closed), 1) if closed else None,
            "total_r": round(sum(float(r["outcome_r"]) for r in closed), 2) if closed else 0.0,
            "pnl_today": round(self._today_pnl(), 2),
            "log": self.log[-20:],
            "recent": [{k: v for k, v in r.items() if k != "card"} | {
                "direction": r["card"]["direction"],
                "strategy": r["card"]["strategy"],
                "score": r["card"]["score"],
                "entry": r["card"]["entry"]["price"],
                "stop": r["card"]["stop"]["price"],
                "target": r["card"]["targets"][0]["price"],
            } for r in self.tracked[-15:]],
            "note": "Paper mode logs signals and hypothetical outcomes. No orders are ever sent.",
        }
