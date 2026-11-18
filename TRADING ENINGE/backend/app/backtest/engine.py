"""Event-driven backtester.

Replays closed bars and calls the *same* `build_context` + `signals.evaluate`
path used live. Orders can only fill on bars after the signal bar, so there is
no path for future information to enter.

Modelled costs: commission per contract per side, entry slippage, stop
slippage, partial fills (a liquidity proxy), and stop-run fills at the worse
price. Intrabar ambiguity always resolves against the position (stop first).
"""
from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass, field

import numpy as np

from ..analysis.context import build_context
from ..analysis.prep import get_prepared
from ..data.frame import TIMEFRAMES
from ..session import session_label, to_et
from ..signals.engine import evaluate
from ..signals import risk as risk_mod
from . import metrics as metrics_mod


@dataclass
class RunSettings:
    risk: dict
    signals: dict
    backtest: dict


@dataclass
class PendingOrder:
    card: dict
    created_index: int
    expires_index: int
    remaining: int
    partial_bars: int = 0
    filled_qty: int = 0
    attempts: int = 0


@dataclass
class OpenPosition:
    card: dict
    direction: str
    entry_price: float
    entry_ts: int
    entry_index: int
    stop: float
    stop_initial: float
    targets: list[float]
    size: int
    remaining: int
    realized: float = 0.0
    commission: float = 0.0
    slippage_dollars: float = 0.0
    exits: list = field(default_factory=list)
    breakeven_done: bool = False
    mfe_r: float = 0.0
    mae_r: float = 0.0
    risk_dollars: float = 0.0
    regime: str = ""
    session: str = ""
    dow: str = ""


class Backtester:
    def __init__(self, cfg, book, registry, fundamentals, svc) -> None:
        self.cfg = cfg
        self.book = book
        self.registry = registry
        self.fundamentals = fundamentals
        self.svc = svc

    # ------------------------------------------------------------------ setup
    def _settings(self, risk_overrides: dict | None, signal_overrides: dict | None) -> RunSettings:
        risk = {**self.cfg.risk, **(risk_overrides or {})}
        signals = {**self.cfg.signals, **(signal_overrides or {})}
        return RunSettings(risk=risk, signals=signals, backtest=self.cfg.backtest)

    def _orderflow(self, symbol: str, ts: int, step: int, frame, i: int, enabled: bool) -> dict:
        if not enabled:
            return {}
        from ..analysis import orderflow as of_mod

        try:
            trades = self.svc.trades(symbol, ts, ts + step)
        except Exception:
            trades = []
        try:
            depth = self.svc.depth_events(symbol, ts, ts + step)
        except Exception:
            depth = []
        snap = of_mod.snapshot(frame, i, trades, depth, self.book.get(symbol).tick_size)
        atr = None
        return snap

    # -------------------------------------------------------------------- run
    def run(
        self,
        symbol: str,
        timeframe: str = "5m",
        bars: int | None = None,
        start_index: int | None = None,
        end_index: int | None = None,
        risk_overrides: dict | None = None,
        signal_overrides: dict | None = None,
        strategy_overrides: dict | None = None,
        include_orderflow: bool = False,
        label: str = "in-sample",
    ) -> dict:
        symbol = symbol.upper()
        inst = self.book.get(symbol)
        settings = self._settings(risk_overrides, signal_overrides)
        frame = self.svc.frame(symbol, timeframe, bars)
        if len(frame) < 50:
            return {"error": "not enough bars to backtest", "trades": [], "metrics": metrics_mod.compute([])}
        if strategy_overrides:
            saved = self.cfg.overrides.get("strategies")
            self.cfg.overrides["strategies"] = {**(saved or {}), **strategy_overrides}
            try:
                prep = get_prepared(frame, inst)
            finally:
                if saved is None:
                    self.cfg.overrides.pop("strategies", None)
                else:
                    self.cfg.overrides["strategies"] = saved
        else:
            prep = get_prepared(frame, inst)

        step = TIMEFRAMES[frame.timeframe]
        bt = settings.backtest
        warmup = int(bt.get("warmup_bars", 250))
        start = max(warmup, start_index if start_index is not None else warmup)
        end = min(len(frame) - 1, end_index if end_index is not None else len(frame) - 1)
        commission = float(bt.get("commission_per_contract_side", 1.25))
        slip_ticks = float(bt.get("slippage_ticks", 1))
        stop_slip = float(bt.get("stop_slippage_ticks", 2))
        max_per_bar = int(bt.get("max_contracts_per_bar", 10))
        partial_bars = int(bt.get("partial_fill_bars", 2))
        fractions = list(bt.get("target_fill_fraction", [0.5, 0.25, 0.25]))
        breakeven = bool(bt.get("breakeven_after_t1", True))
        max_hold = int(settings.signals.get("expiry_bars", 6)) * 8
        specs = inst

        pending: PendingOrder | None = None
        position: OpenPosition | None = None
        trades: list[dict] = []
        equity = float(settings.risk.get("account_size", 25000))
        day_state = {"date": None, "trades": 0, "pnl": 0.0, "losses": 0, "locked": False, "reason": None}
        cooldown_until = -1
        no_trade_counts: dict[str, int] = {}
        skipped_orderflow = not include_orderflow

        def close_leg(pos: OpenPosition, qty: int, price: float, ts: int, index: int, reason: str) -> None:
            nonlocal equity
            if qty <= 0:
                return
            sign = 1 if pos.direction == "long" else -1
            gross = (price - pos.entry_price) * sign * qty * specs.dollars_per_point
            comm = commission * qty * 2  # entry + exit, per contract per side
            pos.realized += gross
            pos.commission += comm
            pos.exits.append({"qty": qty, "price": round(price, 6), "reason": reason,
                              "ts": ts, "gross": round(gross, 2)})
            pos.remaining -= qty

        def finalize(pos: OpenPosition, ts: int, index: int, reason: str) -> dict:
            nonlocal equity
            total = pos.realized - pos.commission
            equity += total
            risk_dollars = max(pos.risk_dollars, 1e-9)
            row = {
                "id": uuid.uuid4().hex[:10],
                "symbol": symbol,
                "contract": pos.card.get("contract", symbol),
                "strategy": pos.card.get("strategy"),
                "strategy_label": pos.card.get("strategy_label"),
                "family": pos.card.get("family"),
                "direction": pos.direction,
                "entry_ts": pos.entry_ts,
                "entry_time_et": to_et(pos.entry_ts).strftime("%Y-%m-%d %H:%M"),
                "entry_price": round(pos.entry_price, 6),
                "stop_initial": round(pos.stop_initial, 6),
                "targets": [round(t, 6) for t in pos.targets],
                "size": pos.size,
                "exit_ts": ts,
                "exit_time_et": to_et(ts).strftime("%Y-%m-%d %H:%M"),
                "exit_reason": reason,
                "exits": pos.exits,
                "avg_exit": round(sum(e["price"] * e["qty"] for e in pos.exits) / max(1, sum(e["qty"] for e in pos.exits)), 6),
                "pnl": round(total, 2),
                "gross_pnl": round(pos.realized, 2),
                "commission": round(pos.commission, 2),
                "slippage_dollars": round(pos.slippage_dollars, 2),
                "r_multiple": round(total / risk_dollars, 3),
                "risk_dollars": round(risk_dollars, 2),
                "bars_held": index - pos.entry_index,
                "score": pos.card.get("score"),
                "regime": pos.regime,
                "session": pos.session,
                "dow": pos.dow,
                "mfe_r": round(pos.mfe_r, 2),
                "mae_r": round(pos.mae_r, 2),
            }
            trades.append(row)
            day_state["trades"] += 1
            day_state["pnl"] += total
            if total <= 0:
                day_state["losses"] += 1
                if day_state["losses"] >= int(settings.risk.get("max_consecutive_losses", 99)):
                    day_state["locked"] = True
                    day_state["reason"] = f"{day_state['losses']} consecutive losses, locked for the day"
            else:
                day_state["losses"] = 0
            return row

        for i in range(start, end + 1):
            ts = int(frame.ts[i])
            td = to_et(ts).date().isoformat()
            if td != day_state["date"]:
                day_state = {"date": td, "trades": 0, "pnl": 0.0, "losses": 0, "locked": False, "reason": None}
            o = float(frame.open[i]); h = float(frame.high[i]); l = float(frame.low[i]); c = float(frame.close[i])

            # ---------------- manage open position ---------------------------
            if position is not None:
                sign = 1 if position.direction == "long" else -1
                risk = max(abs(position.entry_price - position.stop_initial), specs.tick_size)
                position.mfe_r = max(position.mfe_r, sign * ((h if sign > 0 else l) - position.entry_price) / risk)
                position.mae_r = min(position.mae_r, sign * ((l if sign > 0 else h) - position.entry_price) / risk)
                stopped = (l <= position.stop) if sign > 0 else (h >= position.stop)
                if stopped:
                    fill = position.stop - sign * stop_slip * specs.tick_size
                    qty = position.remaining
                    slip_cost = abs(fill - position.stop) * qty * specs.dollars_per_point
                    position.slippage_dollars += slip_cost
                    close_leg(position, qty, fill, ts, i, "stop")
                    finalize(position, ts, i, "stop")
                    position = None
                else:
                    for k, target in enumerate(position.targets):
                        if position.remaining <= 0:
                            break
                        hit = (h >= target) if sign > 0 else (l <= target)
                        if hit:
                            frac = fractions[k] if k < len(fractions) else 0.33
                            qty = max(1, int(round(position.size * frac)))
                            qty = min(qty, position.remaining)
                            close_leg(position, qty, target, ts, i, f"target_{k+1}")
                            if k == 0 and breakeven:
                                position.stop = position.entry_price
                                position.breakeven_done = True
                    if position.remaining <= 0:
                        finalize(position, ts, i, "targets")
                        position = None
                    elif (i - position.entry_index) >= max_hold:
                        fill = c - sign * slip_ticks * specs.tick_size
                        position.slippage_dollars += abs(fill - c) * position.remaining * specs.dollars_per_point
                        close_leg(position, position.remaining, fill, ts, i, "time")
                        finalize(position, ts, i, "time_stop")
                        position = None

            # ---------------- pending order fills ----------------------------
            if position is None and pending is not None:
                if i > pending.expires_index and pending.filled_qty == 0:
                    pending = None
                else:
                    card = pending.card
                    direction = card["direction"]
                    entry = float(card["entry"]["price"])
                    sign = 1 if direction == "long" else -1
                    fill_price = None
                    if card["entry"]["type"] == "limit":
                        if (sign > 0 and l <= entry) or (sign < 0 and h >= entry):
                            fill_price = min(entry, o) if sign > 0 else max(entry, o)
                    else:
                        if (sign > 0 and h >= entry) or (sign < 0 and l <= entry):
                            fill_price = max(entry, o) if sign > 0 else min(entry, o)
                            fill_price += sign * slip_ticks * specs.tick_size
                    if fill_price is not None:
                        available = min(pending.remaining, max_per_bar)
                        pending.filled_qty += available
                        pending.remaining -= available
                        pending.attempts += 1
                        slip = abs(fill_price - entry) * available * specs.dollars_per_point
                        stop = float(card["stop"]["price"])
                        targets = [float(t["price"]) for t in card["targets"]]
                        risk_pts = max(abs(fill_price - stop), specs.tick_size)
                        position = OpenPosition(
                            card=card, direction=direction, entry_price=fill_price, entry_ts=ts,
                            entry_index=i, stop=stop, stop_initial=stop, targets=targets,
                            size=available, remaining=available,
                            slippage_dollars=slip,
                            risk_dollars=risk_pts * specs.dollars_per_point * available,
                            regime=str(card.get("regime", {}).get("trend_regime") or "unknown"),
                            session=session_label(ts),
                            dow=to_et(ts).strftime("%a"),
                        )
                        if pending.remaining > 0:
                            pending.partial_bars += 1
                            if pending.partial_bars > partial_bars:
                                pending = None
                        else:
                            pending = None
                        # conservative: allow a same-bar stop-out, never a same-bar target
                        if (position.direction == "long" and l <= position.stop) or \
                           (position.direction == "short" and h >= position.stop):
                            fill = position.stop - (1 if position.direction == "long" else -1) * stop_slip * specs.tick_size
                            close_leg(position, position.remaining, fill, ts, i, "stop")
                            finalize(position, ts, i, "stop")
                            position = None
                            cooldown_until = i + int(settings.signals.get("cooldown_bars", 3))
                            continue

            # ---------------- new signal -------------------------------------
            if position is None and pending is None and i >= cooldown_until:
                funds = self.fundamentals.pack(symbol, inst.sector, ts)
                of_snap = self._orderflow(symbol, ts, step, frame, i, include_orderflow)
                if not of_snap:
                    from ..analysis import orderflow as of_mod

                    of_snap = {
                        "available": False, "has_trades": False, "has_depth": False,
                        "delta": None, "cumulative_delta": None, "footprint": [], "icebergs": [],
                        "stacked": [], "absorption": None,
                        "reason": "Replay order flow disabled (enable it to include tick/depth strategies).",
                    }
                ctx = build_context(prep, i, fundamentals=funds, orderflow=of_snap,
                                    capabilities=self.svc.capabilities(symbol), light=True)
                state = {"trades_today": day_state["trades"], "pnl_today": day_state["pnl"],
                         "consecutive_losses": day_state["losses"], "locked": day_state["locked"],
                         "lock_reason": day_state["reason"]}
                res = evaluate(ctx, self.registry, settings, funds,
                               self.svc.capabilities(symbol), state)
                if res["state"] == "signal":
                    card = res["signal"]
                    if card["size"]["contracts"] > 0 and not card["blocked"]:
                        expiry = int(settings.signals.get("expiry_bars", 6))
                        pending = PendingOrder(card=card, created_index=i,
                                               expires_index=i + expiry,
                                               remaining=int(card["size"]["contracts"]))
                else:
                    for reason in res.get("reasons", []):
                        no_trade_counts[reason["code"]] = no_trade_counts.get(reason["code"], 0) + 1

        # close any residual position at the last close
        if position is not None:
            sign = 1 if position.direction == "long" else -1
            close_leg(position, position.remaining, float(frame.close[end]), int(frame.ts[end]), end, "end_of_data")
            finalize(position, int(frame.ts[end]), end, "end_of_data")

        report = {
            "metrics": metrics_mod.full_report(trades, float(settings.risk.get("account_size", 25000))),
            "trades": trades,
        }
        report.update({
            "symbol": symbol,
            "timeframe": timeframe,
            "label": label,
            "bars": end - start + 1,
            "start_ts": int(frame.ts[start]),
            "end_ts": int(frame.ts[end]),
            "data_provider": self.svc.provider,
            "synthetic": frame.synthetic,
            "settings": {
                "risk": {k: settings.risk.get(k) for k in
                         ("account_size", "risk_mode", "risk_per_trade", "risk_percent",
                          "buying_power_per_trade", "min_rr", "max_contracts")},
                "signals": {k: settings.signals.get(k) for k in ("threshold", "expiry_bars", "cooldown_bars")},
                "costs": {
                    "commission_per_contract_side": commission,
                    "slippage_ticks": slip_ticks,
                    "stop_slippage_ticks": stop_slip,
                    "max_contracts_per_bar": max_per_bar,
                    "partial_fill_bars": partial_bars,
                },
            },
            "no_trade_counts": no_trade_counts,
            "warnings": [],
            "disclaimer": ("Hypothetical results. Costs are modelled, not observed. "
                           "Absorption/iceberg strategies need tick+depth replay to be included."),
            "reproducible_hash": _hash_trades(trades),
        })
        report["warnings"] = list(report.get("warnings") or [])
        report["equity_curve"] = metrics_mod.equity_curve(
            trades, float(settings.risk.get("account_size", 25000)))
        if frame.synthetic:
            report["warnings"].append("Backtest ran on SIMULATED data. Results say nothing about real markets.")
        if skipped_orderflow:
            report["warnings"].append("Order-flow strategies were excluded: tick/depth replay disabled for speed.")
        if report["metrics"]["trades"] and report["metrics"]["trades"] < 30:
            report["warnings"].append(report["metrics"]["sample_warning"])
        if label == "out-of-sample":
            report["warnings"].append("Out-of-sample segment: parameters were not fitted on these bars.")
        return report


def _hash_trades(trades: list[dict]) -> str:
    payload = [[t["entry_ts"], t["exit_ts"], round(float(t["entry_price"]), 4),
                round(float(t["pnl"]), 2), t["size"], t["strategy"], t["exit_reason"]] for t in trades]
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:16]
