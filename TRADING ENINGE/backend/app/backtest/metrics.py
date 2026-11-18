"""Performance metrics computed from closed trades. Net of commissions and slippage."""
from __future__ import annotations

import math
from collections import defaultdict

import numpy as np

MIN_SAMPLE = 30


def _r_values(trades: list[dict]) -> list[float]:
    return [float(t["r_multiple"]) for t in trades if t.get("r_multiple") is not None]


def drawdown(equity: list[float]) -> tuple[float, float]:
    if not equity:
        return 0.0, 0.0
    peak = equity[0]
    max_dd = 0.0
    max_dd_pct = 0.0
    for v in equity:
        peak = max(peak, v)
        dd = peak - v
        max_dd = max(max_dd, dd)
        if peak > 0:
            max_dd_pct = max(max_dd_pct, dd / peak * 100)
    return max_dd, max_dd_pct


def compute(trades: list[dict], starting_equity: float = 25000.0) -> dict:
    n = len(trades)
    if n == 0:
        return {
            "trades": 0, "wins": 0, "losses": 0, "win_rate": None, "expectancy_r": None,
            "profit_factor": None, "net_pnl": 0.0, "gross_profit": 0.0, "gross_loss": 0.0,
            "avg_win_r": None, "avg_loss_r": None, "max_drawdown": 0.0, "max_drawdown_pct": 0.0,
            "avg_bars_held": None, "total_commission": 0.0, "total_slippage": 0.0,
            "sample_warning": "No trades were generated, so statistics are unavailable.",
            "caveat": "Backtest results are hypothetical and cost-adjusted. They are not a forecast.",
        }
    pnl = np.array([float(t["pnl"]) for t in trades])
    rs = np.array(_r_values(trades) or [0.0])
    wins = [t for t in trades if float(t["pnl"]) > 0]
    losses = [t for t in trades if float(t["pnl"]) <= 0]
    gross_profit = float(sum(float(t["pnl"]) for t in wins))
    gross_loss = float(-sum(float(t["pnl"]) for t in losses))
    equity = starting_equity + np.cumsum(pnl)
    max_dd, max_dd_pct = drawdown([starting_equity] + equity.tolist())
    win_r = [float(t["r_multiple"]) for t in wins if t.get("r_multiple") is not None]
    loss_r = [float(t["r_multiple"]) for t in losses if t.get("r_multiple") is not None]
    warnings = []
    if n < MIN_SAMPLE:
        warnings.append(f"Small sample: {n} trades. Treat every statistic as provisional (minimum {MIN_SAMPLE}).")
    if n < 10:
        warnings.append("Fewer than 10 trades. Treat the result as noise, not evidence of an edge.")
    if float(np.std(rs)) > 0 and n >= 5:
        t_stat = float(np.mean(rs) / (np.std(rs, ddof=1) / math.sqrt(n)))
        if t_stat < 2:
            warnings.append(f"Expectancy t-statistic is {t_stat:.1f}, below 2, so this edge is not distinguishable from noise.")
    return {
        "trades": n,
        "wins": len(wins),
        "losses": len(losses),
        "win_rate": round(len(wins) / n * 100, 2),
        "expectancy_r": round(float(np.mean(rs)), 3),
        "expectancy_dollars": round(float(np.mean(pnl)), 2),
        "profit_factor": round(gross_profit / gross_loss, 2) if gross_loss > 0 else None,
        "net_pnl": round(float(pnl.sum()), 2),
        "gross_profit": round(gross_profit, 2),
        "gross_loss": round(gross_loss, 2),
        "avg_win_r": round(float(np.mean(win_r)), 3) if win_r else None,
        "avg_loss_r": round(float(np.mean(loss_r)), 3) if loss_r else None,
        "avg_win_dollars": round(float(np.mean([float(t["pnl"]) for t in wins])), 2) if wins else None,
        "avg_loss_dollars": round(float(np.mean([float(t["pnl"]) for t in losses])), 2) if losses else None,
        "max_drawdown": round(max_dd, 2),
        "max_drawdown_pct": round(max_dd_pct, 2),
        "max_drawdown_r": round(float(np.max(np.maximum.accumulate(np.cumsum(rs)) - np.cumsum(rs))) if n else 0.0, 2),
        "r_std": round(float(np.std(rs, ddof=1)), 3) if n > 1 else None,
        "avg_bars_held": round(float(np.mean([t["bars_held"] for t in trades])), 1),
        "total_commission": round(float(sum(t.get("commission", 0) for t in trades)), 2),
        "total_slippage": round(float(sum(t.get("slippage_dollars", 0) for t in trades)), 2),
        "largest_win": round(float(pnl.max()), 2),
        "largest_loss": round(float(pnl.min()), 2),
        "final_equity": round(float(equity[-1]), 2),
        "sample_warning": warnings[0] if warnings else None,
        "warnings": warnings,
        "caveat": "Backtest results are hypothetical, cost-adjusted and in-sample unless labelled out-of-sample.",
    }


def group_by(trades: list[dict], key: str, label: str) -> list[dict]:
    buckets: dict[str, list[dict]] = defaultdict(list)
    for t in trades:
        buckets[str(t.get(key) or "unknown")].append(t)
    out = []
    for name, rows in buckets.items():
        stats = compute(rows)
        out.append({
            "name": name, "label": label,
            "trades": stats["trades"], "win_rate": stats["win_rate"],
            "expectancy_r": stats["expectancy_r"], "net_pnl": stats["net_pnl"],
            "profit_factor": stats["profit_factor"],
        })
    out.sort(key=lambda r: -(r["net_pnl"] or 0))
    return out


def full_report(trades: list[dict], starting_equity: float = 25000.0) -> dict:
    base = compute(trades, starting_equity)
    base["by_strategy"] = group_by(trades, "strategy", "Strategy")
    base["by_session"] = group_by(trades, "session", "Session")
    base["by_regime"] = group_by(trades, "regime", "Regime")
    base["by_day_of_week"] = group_by(trades, "dow", "Day of week")
    base["by_direction"] = group_by(trades, "direction", "Direction")
    base["by_exit"] = group_by(trades, "exit_reason", "Exit")
    return base


def equity_curve(trades: list[dict], starting_equity: float = 25000.0) -> list[dict]:
    eq = starting_equity
    peak = eq
    out = []
    for t in trades:
        eq += float(t["pnl"])
        peak = max(peak, eq)
        out.append({
            "ts": int(t["exit_ts"]), "equity": round(eq, 2),
            "drawdown": round(peak - eq, 2), "pnl": round(float(t["pnl"]), 2),
            "r": round(float(t.get("r_multiple") or 0), 2), "strategy": t.get("strategy"),
        })
    return out
