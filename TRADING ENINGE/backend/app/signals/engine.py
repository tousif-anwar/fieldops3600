"""Signal engine: turn strategy candidates into checkable cards, or a clear no-trade."""
from __future__ import annotations

import uuid

from ..analysis.context import Context
from ..analysis.regime import strategy_allowed
from ..data.frame import TIMEFRAMES
from ..strategies.base import SignalCandidate
from . import risk as risk_mod
from .scoring import score_candidate

DISCLAIMER = (
    "Decision support only, not financial advice. Futures trading carries a "
    "substantial risk of loss. No outcome is guaranteed. Every statistic shown "
    "comes from a backtest or a paper trade on your own data."
)


def _no_trade(reasons: list[dict], ctx: Context, extras: dict | None = None) -> dict:
    out = {
        "state": "no_trade",
        "symbol": ctx.inst.symbol,
        "timeframe": ctx.timeframe,
        "time": ctx.ts,
        "price": ctx.price,
        "reasons": reasons,
        "signal": None,
        "disclaimer": DISCLAIMER,
    }
    if extras:
        out.update(extras)
    return out


def _ninjatrader_ticket(contract: str, direction: str, entry: float, stop: float,
                        targets: list[float], contracts: int, entry_type: str, inst) -> dict:
    side = "BUY" if direction == "long" else "SELL"
    order = "LIMIT" if entry_type == "limit" else "STOP MARKET"
    dec = inst.decimals()
    text = (
        f"{side} {contract}  qty {contracts}  {order} @ {entry:,.{dec}f}\n"
        f"STOP {stop:,.{dec}f}   T1 {targets[0]:,.{dec}f}"
        + (f"   T2 {targets[1]:,.{dec}f}" if len(targets) > 1 else "")
        + (f"   T3 {targets[2]:,.{dec}f}" if len(targets) > 2 else "")
        + "\nNinjaTrader: SuperDOM / Chart Trader, ATM strategy with stop and targets above."
    )
    return {
        "platform": "NinjaTrader",
        "symbol": contract,
        "side": side,
        "quantity": contracts,
        "order_type": order,
        "entry": entry,
        "stop": stop,
        "targets": targets,
        "text": text,
        "note": "Paste/enter manually. This app never transmits an order.",
    }


def build_card(ctx: Context, cand: SignalCandidate, cfg, fundamentals: dict, capabilities: dict) -> dict:
    inst = ctx.inst
    tick = inst.tick_size
    direction = cand.direction
    entry = inst.round_tick(cand.entry)
    stop = inst.round_tick(cand.stop)
    targets = [inst.round_tick(t) for t in cand.targets]

    # keep stop on the correct side of entry after rounding
    if direction == "long" and stop >= entry:
        stop = inst.round_tick(entry - max(tick * 4, ctx.atr * 0.5))
    if direction == "short" and stop <= entry:
        stop = inst.round_tick(entry + max(tick * 4, ctx.atr * 0.5))

    scoring = score_candidate(ctx, cand, fundamentals, cfg.risk)
    regime_mult = float(ctx.regime.get("size_multiplier", 1.0) or 1.0)
    fund_mult = float((fundamentals or {}).get("size_multiplier", 1.0) or 1.0)
    size_mult = min(regime_mult, fund_mult)
    sizing = risk_mod.size_position(inst, entry, stop, cfg.risk, size_mult)
    math_ = risk_mod.trade_math(inst, entry, stop, targets, max(1, sizing["contracts"]))
    risk_pts = abs(entry - stop)
    risk_ticks = inst.ticks(risk_pts)
    rr = math_["rr"]

    min_rr = float(cfg.risk.get("min_rr", 1.0) or 0)
    min_stop_ticks = int(cfg.signals.get("min_stop_ticks", 2) or 2)
    blocked: list[dict] = []
    if risk_ticks < min_stop_ticks:
        blocked.append({"code": "stop_too_tight",
                        "message": f"Stop is {risk_ticks} ticks, below the {min_stop_ticks}-tick minimum."})
    if rr is not None and rr < min_rr:
        blocked.append({"code": "rr_below_min",
                        "message": f"Reward:risk {rr:.2f} is below the configured minimum {min_rr:.2f}."})
    if sizing["contracts"] <= 0:
        blocked.append({"code": "size_zero",
                        "message": f"Position size rounds to 0 contracts: stop risk {sizing['per_contract_risk']:.2f} USD "
                                   f"per contract exceeds the {sizing['effective_budget']:.2f} USD budget."})
    threshold = float(cfg.signals.get("threshold", 60))
    if scoring["score"] < threshold:
        blocked.append({"code": "below_threshold",
                        "message": f"Confluence score {scoring['score']} is below the {threshold:.0f} threshold."})
    if (fundamentals or {}).get("news_window") and not cfg.risk.get("allow_news_window_trades", False):
        blocked.append({"code": "news_window",
                        "message": (fundamentals or {}).get("news_window_detail", {}).get("reason",
                                                                                        "High-impact release window.")})

    session = ctx.session
    checks = risk_mod.checklist([
        ("Confluence score above threshold", scoring["score"] >= threshold,
         f"{scoring['score']} vs {threshold:.0f}"),
        (f"Reward:risk at least 1:{min_rr:g}", rr is not None and rr >= min_rr, f"T1 R:R {rr:.2f}" if rr else "n/a"),
        ("Stop distance sane", risk_ticks >= min_stop_ticks, f"{risk_ticks} ticks / {risk_pts:.2f} points"),
        ("Position size above zero", sizing["contracts"] > 0,
         f"{sizing['contracts']} contract(s), limited by {sizing['binding_label']}"),
        ("Outside high-impact release window", not (fundamentals or {}).get("news_window"),
         (fundamentals or {}).get("news_window_detail", {}).get("reason", "clear")),
        ("Session open for this market", session.get("is_open", True), session.get("phase", "")),
        ("Single defined invalidation", True, cand.invalidation),
        ("Trade is on your plan", True, "Confirm against your own written plan before sending."),
    ])

    expiry_seconds = int(cfg.signals.get("expiry_bars", 6)) * TIMEFRAMES.get(ctx.timeframe, 300)
    contract_info = ctx.inst.spec()
    try:
        from ..instruments import contract_label

        contract_info.update(contract_label(inst))
    except Exception:
        contract_info["code"] = inst.symbol

    card = {
        "id": uuid.uuid4().hex[:12],
        "state": "signal",
        "symbol": inst.symbol,
        "contract": contract_info.get("code", inst.symbol),
        "timeframe": ctx.timeframe,
        "strategy": cand.strategy,
        "strategy_label": cand.label,
        "family": cand.family,
        "direction": direction,
        "created_ts": ctx.ts,
        "created_et": ctx.session.get("trading_date"),
        "expires_ts": ctx.ts + expiry_seconds,
        "expiry_bars": int(cfg.signals.get("expiry_bars", 6)),
        "price_at_signal": ctx.price,
        "score": scoring["score"],
        "score_label": scoring["label"],
        "score_detail": scoring,
        "entry": {
            "type": cand.entry_type,
            "price": entry,
            "alternative_type": "stop" if cand.entry_type == "limit" else "limit",
            "alternative_price": inst.round_tick(cand.alternative_entry) if cand.alternative_entry else None,
            "reason": cand.entry_reason,
        },
        "stop": {
            "price": stop,
            "points": round(risk_pts, 6),
            "ticks": risk_ticks,
            "reason": cand.stop_reason,
            "risk_per_contract": round(risk_pts * inst.dollars_per_point, 2),
        },
        "targets": [
            {"label": f"T{i+1}", "price": t, "points": row["points"], "ticks": row["ticks"],
             "reward_dollars": row["reward_dollars"], "rr": row["rr"],
             "reason": cand.target_reasons[i] if i < len(cand.target_reasons) else "structure projection"}
            for i, (t, row) in enumerate(zip(targets, math_["targets"]))
        ],
        "size": {
            "contracts": sizing["contracts"],
            "binding": sizing["binding"],
            "binding_label": sizing["binding_label"],
            "risk_dollars": sizing["risk_dollars"],
            "reward_dollars": math_["reward_dollars"],
            "rr": rr,
            "per_contract_risk": sizing["per_contract_risk"],
            "budget": sizing["budget"],
            "budget_label": sizing["budget_label"],
            "effective_budget": sizing["effective_budget"],
            "size_multiplier": sizing["size_multiplier"],
            "margin": sizing["margin"],
            "margin_required": sizing["margin_required"],
            "max_by_risk": sizing["max_by_risk"],
            "max_by_buying_power": sizing["max_by_buying_power"],
            "max_by_cap": sizing["max_by_cap"],
            "dollars_per_point": inst.dollars_per_point,
            "tick_size": inst.tick_size,
            "tick_value": round(inst.tick_size * inst.dollars_per_point, 4),
        },
        "invalidation": cand.invalidation,
        "reasons": cand.reasons,
        "target_reasons": cand.target_reasons,
        "checks": checks,
        "blocked": blocked,
        "levels_used": [lv for lv in ctx.levels
                        if abs(lv["price"] - entry) <= ctx.tick * 10
                        or abs(lv["price"] - stop) <= ctx.tick * 10
                        or any(abs(lv["price"] - t) <= ctx.tick * 10 for t in targets)][:12],
        "regime": ctx.regime,
        "session": ctx.session,
        "fundamental": {
            "bias": fundamentals.get("bias"),
            "score": fundamentals.get("score"),
            "reasons": fundamentals.get("reasons", []),
            "news_window": fundamentals.get("news_window"),
            "size_multiplier": fundamentals.get("size_multiplier"),
            "providers": fundamentals.get("providers", {}),
        },
        "orderflow": {
            "available": (ctx.orderflow or {}).get("available", False),
            "delta": (ctx.orderflow or {}).get("delta"),
            "cumulative_delta": (ctx.orderflow or {}).get("cumulative_delta"),
            "icebergs": (ctx.orderflow or {}).get("icebergs", []),
            "absorption": (ctx.orderflow or {}).get("absorption"),
            "note": (ctx.orderflow or {}).get("reason"),
        },
        "data": {
            "provider": (capabilities.dict().get("provider") if hasattr(capabilities, "dict")
                         else capabilities.get("provider") if isinstance(capabilities, dict) else None),
            "synthetic": ctx.prep.frame.synthetic,
        },
        "ninjatrader": _ninjatrader_ticket(contract_info.get("code", inst.symbol), direction,
                                           entry, stop, targets, max(1, sizing["contracts"]),
                                           cand.entry_type, inst),
        "disclaimer": DISCLAIMER,
    }
    return card


def evaluate(ctx: Context, registry, cfg, fundamentals: dict, capabilities: dict,
             session_state: dict | None = None) -> dict:
    """Full signal decision for one closed bar."""
    st = session_state or {}
    reasons: list[dict] = []

    # ---- hard locks ------------------------------------------------------
    if st.get("locked"):
        reasons.append({"code": "locked", "message": st.get("lock_reason") or "Trading locked by risk rules."})
    if st.get("trades_today", 0) >= int(cfg.risk.get("max_trades_per_day", 99)):
        reasons.append({"code": "max_trades", "message":
                        f"Daily trade limit reached ({st.get('trades_today')}/{cfg.risk.get('max_trades_per_day')})."})
    if float(st.get("pnl_today", 0.0)) <= -abs(float(cfg.risk.get("daily_max_loss", 1e9))):
        reasons.append({"code": "daily_loss", "message":
                        f"Daily max loss hit ({st.get('pnl_today'):.2f} USD)."})
    if st.get("consecutive_losses", 0) >= int(cfg.risk.get("max_consecutive_losses", 99)):
        reasons.append({"code": "loss_streak", "message":
                        f"{st.get('consecutive_losses')} consecutive losses. Cooling off."})

    if (fundamentals or {}).get("news_window") and not cfg.risk.get("allow_news_window_trades", False):
        detail = (fundamentals or {}).get("news_window_detail", {})
        reasons.append({"code": "news_window", "message": detail.get("reason", "High-impact news window.")})

    if reasons:
        return _no_trade(reasons, ctx, {"locks": st})

    # ---- strategy evaluation --------------------------------------------
    candidates = registry.evaluate_all(ctx)
    errors = list(getattr(registry, "last_errors", []) or [])
    if not candidates:
        return _no_trade([{"code": "no_setup", "message":
                           "No enabled strategy produced a valid setup on this closed bar."}], ctx,
                         {"disabled_strategies": registry.disabled(ctx.capabilities),
                          "strategy_errors": errors})

    scored = []
    for cand in candidates:
        allowed, why = strategy_allowed(ctx.regime, cand.family)
        s = score_candidate(ctx, cand, fundamentals, cfg.risk)
        scored.append({"candidate": cand, "score": s, "regime_allowed": allowed, "regime_reason": why})
    scored.sort(key=lambda x: -x["score"]["score"])
    best = scored[0]
    threshold = float(cfg.signals.get("threshold", 60))

    if not best["regime_allowed"]:
        return _no_trade([{"code": "regime", "message": best["regime_reason"]}], ctx,
                         {"best_score": best["score"]["score"],
                          "candidates": [_candidate_summary(s) for s in scored]})
    if best["score"]["score"] < threshold:
        return _no_trade([
            {"code": "low_score", "message":
             f"Best setup scored {best['score']['score']}, below the {threshold:.0f} threshold."},
            {"code": "top_factor", "message":
             f"Main factor: {best['score']['factors'][0]['detail']}"},
        ], ctx, {"best_score": best["score"]["score"],
                 "candidates": [_candidate_summary(s) for s in scored]})

    card = build_card(ctx, best["candidate"], cfg, fundamentals, capabilities)
    if card["blocked"]:
        return _no_trade(card["blocked"], ctx, {"best_score": card["score"], "signal": card,
                                                "candidates": [_candidate_summary(s) for s in scored]})
    if not ctx.session.get("is_open", True):
        return _no_trade([{"code": "market_closed", "message": "Market is closed for this session."}], ctx,
                         {"best_score": card["score"], "signal": card})
    card["candidates"] = [_candidate_summary(s) for s in scored]
    return {"state": "signal", "signal": card, "reasons": [], "best_score": card["score"]}


def _candidate_summary(row: dict) -> dict:
    cand: SignalCandidate = row["candidate"]
    return {
        "strategy": cand.strategy, "label": cand.label, "direction": cand.direction,
        "score": row["score"]["score"], "entry": cand.entry, "stop": cand.stop,
        "target": cand.targets[0] if cand.targets else None,
        "rr": round(cand.rr(), 2), "regime_allowed": row["regime_allowed"],
        "regime_reason": row["regime_reason"],
    }
