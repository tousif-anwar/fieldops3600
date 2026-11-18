"""Risk, position sizing and the trade-plan checklist.

size = floor(risk_dollars / (stop_points * dollars_per_point)), then capped by
the buying-power limit, the user's max contracts and the risk multipliers from
volatility/news. The binding constraint is always reported.
"""
from __future__ import annotations

import math

from ..instruments import Instrument


def effective_margin(inst: Instrument, risk_cfg: dict) -> float:
    overrides = (risk_cfg or {}).get("margins") or {}
    try:
        return float(overrides.get(inst.symbol, inst.margin))
    except (TypeError, ValueError):
        return float(inst.margin)


def risk_budget(risk_cfg: dict) -> tuple[float, str]:
    account = float(risk_cfg.get("account_size", 25000) or 0)
    mode = str(risk_cfg.get("risk_mode", "dollars"))
    if mode == "percent":
        pct = float(risk_cfg.get("risk_percent", 0.5) or 0)
        return round(account * pct / 100.0, 2), f"{pct:.2f}% of {account:,.0f}"
    return round(float(risk_cfg.get("risk_per_trade", 100) or 0), 2), f"fixed {risk_cfg.get('risk_per_trade')} USD"


def size_position(inst: Instrument, entry: float, stop: float, risk_cfg: dict,
                  size_multiplier: float = 1.0) -> dict:
    stop_points = abs(float(entry) - float(stop))
    stop_ticks = inst.ticks(stop_points)
    per_contract_risk = stop_points * inst.dollars_per_point
    budget, budget_label = risk_budget(risk_cfg)
    effective_budget = budget * max(0.0, min(2.0, size_multiplier))
    margin = effective_margin(inst, risk_cfg)
    bp_limit = float(risk_cfg.get("buying_power_per_trade", 0) or 0)
    max_contracts = int(risk_cfg.get("max_contracts", 100) or 100)

    if per_contract_risk <= 0 or stop_ticks <= 0:
        return {
            "contracts": 0, "binding": "invalid_stop", "budget": budget, "budget_label": budget_label,
            "effective_budget": round(effective_budget, 2), "per_contract_risk": 0,
            "stop_points": 0, "stop_ticks": 0, "margin": margin,
            "risk_dollars": 0, "max_by_risk": 0, "max_by_buying_power": 0, "max_by_cap": max_contracts,
            "note": "stop distance is zero, so the position cannot be sized",
        }
    max_by_risk = int(math.floor(effective_budget / per_contract_risk))
    max_by_bp = int(math.floor(bp_limit / margin)) if margin > 0 and bp_limit > 0 else 0
    contracts = max(0, min(max_by_risk, max_by_bp if max_by_bp > 0 else max_by_risk, max_contracts))
    binding = "risk"
    if contracts == 0:
        binding = "risk" if max_by_risk == 0 else "buying_power"
    elif contracts == max_by_bp and max_by_bp <= max_by_risk and max_by_bp <= max_contracts:
        binding = "buying_power"
    elif contracts == max_contracts and max_contracts < max_by_risk:
        binding = "max_contracts"
    elif contracts == max_by_risk:
        binding = "risk"
    return {
        "contracts": contracts,
        "binding": binding,
        "binding_label": {
            "risk": "risk budget", "buying_power": "buying power / margin",
            "max_contracts": "max contracts cap", "invalid_stop": "invalid stop",
        }[binding],
        "budget": budget,
        "budget_label": budget_label,
        "effective_budget": round(effective_budget, 2),
        "size_multiplier": round(size_multiplier, 2),
        "per_contract_risk": round(per_contract_risk, 2),
        "stop_points": round(stop_points, 6),
        "stop_ticks": stop_ticks,
        "margin": margin,
        "margin_required": round(margin * contracts, 2),
        "buying_power_per_trade": bp_limit,
        "risk_dollars": round(per_contract_risk * contracts, 2),
        "max_by_risk": max_by_risk,
        "max_by_buying_power": max_by_bp,
        "max_by_cap": max_contracts,
    }


def trade_math(inst: Instrument, entry: float, stop: float, targets: list[float], contracts: int) -> dict:
    risk_pts = abs(entry - stop)
    risk_dollars = risk_pts * inst.dollars_per_point * contracts
    rows = []
    for k, t in enumerate(targets, start=1):
        reward_pts = abs(t - entry)
        rows.append({
            "target": k,
            "price": t,
            "points": round(reward_pts, 6),
            "ticks": inst.ticks(reward_pts),
            "reward_dollars": round(reward_pts * inst.dollars_per_point * contracts, 2),
            "rr": round(reward_pts / risk_pts, 2) if risk_pts > 0 else None,
        })
    return {
        "risk_points": round(risk_pts, 6),
        "risk_ticks": inst.ticks(risk_pts),
        "risk_dollars": round(risk_dollars, 2),
        "targets": rows,
        "reward_dollars": rows[0]["reward_dollars"] if rows else 0.0,
        "rr": rows[0]["rr"] if rows else None,
    }


def checklist(checks: list[tuple[str, bool, str]]) -> list[dict]:
    return [{"label": label, "passed": bool(ok), "detail": detail} for label, ok, detail in checks]
