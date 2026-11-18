"""Confluence scoring 0..100 with a full factor breakdown.

Weights are fixed and published; the fundamental layer's weight is user
configurable (risk.fundamental_weight vs risk.technical_weight). Every factor
returns a 0..1 raw score plus a human-readable reason.
"""
from __future__ import annotations

import numpy as np

from ..analysis.context import Context
from ..strategies.base import SignalCandidate

FACTOR_WEIGHTS = {
    "location": 0.18,
    "structure": 0.20,
    "flow": 0.12,
    "trend": 0.14,
    "regime": 0.10,
    "session": 0.09,
    "pattern": 0.07,
}
FACTOR_LABELS = {
    "location": "Location (key level)",
    "structure": "Market structure",
    "flow": "Volume / order flow",
    "trend": "VWAP + trend alignment",
    "regime": "Volatility / trend regime",
    "session": "Session timing",
    "pattern": "Candlestick confirmation",
}
TECHNICAL_FACTORS = [k for k in FACTOR_WEIGHTS if k != "regime"] + ["regime"]

# Regime-dependent reweighting. A trend setup is judged mostly on whether price
# is pulling back with the trend; a fade is judged mostly on where it is. The
# multipliers only redistribute weight inside the technical block, so the
# technical/fundamental split the user configures is untouched.
REGIME_WEIGHT_ADJUST: dict[str, dict[str, float]] = {
    "trending": {"trend": 1.35, "structure": 1.15, "regime": 1.10, "location": 0.90, "pattern": 0.90},
    "ranging": {"location": 1.25, "pattern": 1.10, "regime": 1.10, "trend": 0.75, "structure": 0.90},
    "transitional": {},
}


# A fade is by definition against the prevailing move, so scoring it on trend
# alignment and directional structure measures the opposite of what makes it
# valid. For counter-trend setups those two weights move to location, candle
# confirmation and regime, which is the evidence a fade is actually judged on.
FAMILY_WEIGHT_ADJUST: dict[str, dict[str, float]] = {
    "contra_trend": {"trend": 0.0, "structure": 0.0, "location": 1.6, "pattern": 1.2, "regime": 1.3},
}


def effective_weights(regime: dict | None, family: str | None = None) -> dict[str, float]:
    adj = REGIME_WEIGHT_ADJUST.get((regime or {}).get("trend_regime"), {})
    fam = FAMILY_WEIGHT_ADJUST.get(family or "", {})
    weights = {k: w * adj.get(k, 1.0) * fam.get(k, 1.0) for k, w in FACTOR_WEIGHTS.items()}
    if sum(weights.values()) <= 0:  # never let a configuration zero the block
        return dict(FACTOR_WEIGHTS)
    return weights


def _clip(x: float) -> float:
    return max(0.0, min(1.0, float(x)))


def _location(ctx: Context, cand: SignalCandidate) -> tuple[float, str]:
    tol = 8 * ctx.tick
    level = ctx.level_at(cand.entry, 8)
    cluster = ctx.levels_near(cand.entry, 14)
    score = 0.0
    bits = []
    if level:
        score += 0.55 * float(level["strength"])
        bits.append(f"entry sits on {level['label']} ({level['price']:.2f}, strength {level['strength']:.2f})")
    if len(cluster) >= 2:
        score += 0.2
        bits.append(f"{len(cluster)} levels clustered within 14 ticks")
    target_level = ctx.level_at(cand.targets[0], 10)
    if target_level and abs(cand.targets[0] - cand.entry) > tol:
        score += 0.15
        bits.append(f"target 1 lands on {target_level['label']}")
    zone = None
    for z in ctx.zones:
        z_low = z["low"] if isinstance(z, dict) else z.low
        z_high = z["high"] if isinstance(z, dict) else z.high
        z_kind = z["kind"] if isinstance(z, dict) else z.kind
        if z_low <= cand.entry <= z_high:
            zone = z_kind
            break
    if zone:
        score += 0.15
        bits.append(f"entry inside a {zone} order block")
    if not bits:
        bits.append("entry sits in open space with no meaningful level within 8 ticks")
    return _clip(score), "; ".join(bits)


def _flow(ctx: Context, cand: SignalCandidate) -> tuple[float, str]:
    base, detail = ctx.volume_score()
    of = ctx.orderflow or {}
    if of.get("available"):
        want = 1 if cand.direction == "long" else -1
        delta = of.get("delta")
        if delta is not None:
            if (delta > 0) == (want > 0):
                base = min(1.0, base + 0.2)
                detail += ", delta agrees with direction"
            else:
                base = max(0.0, base - 0.2)
                detail += ", delta disagrees with direction"
        if of.get("absorption"):
            base = min(1.0, base + 0.15)
            detail += ", absorption detected"
        if of.get("icebergs"):
            base = min(1.0, base + 0.1)
            detail += ", probable iceberg nearby (heuristic)"
    else:
        detail += " (candles only, no tick or depth flow)"
        delta, delta_detail = _proxy_delta_check(ctx, cand)
        base = _clip(base + delta)
        detail += delta_detail
    return _clip(base), detail


def _proxy_delta_check(ctx: Context, cand: SignalCandidate) -> tuple[float, str]:
    """Candle-implied delta against the 20-bar price move.

    Without ticks the buy/sell split is unknown, so this reads the close
    position inside each bar's range and asks a simpler question: does that
    proxy move with price? Agreement is mild support, divergence is a warning.
    """
    prep, i = ctx.prep, ctx.index
    if i < 20:
        return 0.0, ""
    price_change = ctx.price - float(prep.frame.close[i - 20])
    delta_sum = float(np.nansum(prep.delta_proxy[i - 19:i + 1]))
    if price_change == 0 or delta_sum == 0:
        return 0.0, ""
    same_direction = (price_change > 0) == (delta_sum > 0)
    aligns_with_trade = (price_change > 0) == (cand.direction == "long")
    if same_direction and aligns_with_trade:
        return 0.10, ", candle-implied delta agrees with the 20-bar move"
    if same_direction:
        return -0.10, ", candle-implied delta leans against this trade"
    return -0.15, ", candle-implied delta diverges from the 20-bar price move"


def _regime(ctx: Context, cand: SignalCandidate) -> tuple[float, str]:
    r = ctx.regime or {}
    trend = r.get("trend_regime")
    vol = r.get("vol_regime")
    score = 0.5
    if trend == "trending":
        score = 0.95 if cand.family == "momentum" else 0.35
    elif trend == "ranging":
        score = 0.95 if cand.family == "contra_trend" else 0.35
    elif trend == "transitional":
        score = 0.6
    if vol == "extreme":
        score *= 0.7
    elif vol == "compressed":
        score *= 0.85
    detail = (f"{r.get('label', 'unknown regime')}; {cand.family.replace('_', ' ')} setup "
              f"{'fits' if score >= 0.6 else 'fights'} the regime")
    return _clip(score), detail


def _pattern(ctx: Context, cand: SignalCandidate) -> tuple[float, str]:
    want = "bull" if cand.direction == "long" else "bear"
    hits = [p for p in ctx.patterns if p["direction"] == want and p.get("bars_ago", 0) <= 2]
    if not hits:
        neutral = [p for p in ctx.patterns if p["direction"] == "neutral" and p.get("bars_ago", 0) == 0]
        if neutral:
            return 0.35, f"{neutral[0]['name']}, no directional confirmation"
        return 0.2, "no matching candlestick confirmation"
    best = max(hits, key=lambda h: h["base_strength"])
    score = best["base_strength"] * 0.7
    at_level = ctx.level_at(best["key_price"], 10) is not None
    volume_ok = best["volume_ratio"] >= 1.2
    if at_level:
        score += 0.18
    if volume_ok:
        score += 0.12
    detail = (f"{best['name']} {best['bars_ago']} bar(s) ago, base {best['base_strength']:.2f}, "
              f"volume {best['volume_ratio']:.2f}x"
              f"{', at a key level' if at_level else ', not at a key level'}")
    # A quantum shift is a volume-confirmed reversal candle against the EMA
    # state, which is exactly the confirmation this factor is scoring.
    shift = ctx.indicators.get("quantum_shift")
    if shift and (shift > 0) == (cand.direction == "long"):
        score += 0.18
        detail += ", quantum shift agrees"
    if not (at_level and volume_ok):
        detail += " - not upgraded (needs level + volume)"
    return _clip(score), detail


def score_candidate(ctx: Context, cand: SignalCandidate, fundamentals: dict, risk_cfg: dict) -> dict:
    raw: dict[str, tuple[float, str]] = {}
    raw["location"] = _location(ctx, cand)
    raw["structure"] = ctx.structure_score(cand.direction)
    raw["flow"] = _flow(ctx, cand)
    raw["trend"] = ctx.trend_alignment(cand.direction)
    raw["regime"] = _regime(ctx, cand)
    raw["session"] = (ctx.timing_score, ctx.timing_reason)
    raw["pattern"] = _pattern(ctx, cand)

    tech_w = float(risk_cfg.get("technical_weight", 0.6) or 0.6)
    fund_w = float(risk_cfg.get("fundamental_weight", 0.4) or 0.4)
    total = tech_w + fund_w
    if total <= 0:
        tech_w, fund_w, total = 0.6, 0.4, 1.0
    tech_w, fund_w = tech_w / total, fund_w / total

    weights = effective_weights(ctx.regime, cand.family)
    weight_sum = sum(weights.values())
    technical = sum(raw[k][0] * weights[k] for k in weights) / weight_sum

    bias = (fundamentals or {}).get("bias", "neutral")
    bias_score = float((fundamentals or {}).get("score", 0.0))
    if bias == "neutral":
        fund_raw = 0.5
    elif (bias == "bullish" and cand.direction == "long") or (bias == "bearish" and cand.direction == "short"):
        fund_raw = 0.75 + 0.25 * min(1.0, abs(bias_score) * 2)
    else:
        fund_raw = 0.15
    if (fundamentals or {}).get("news_window"):
        fund_raw *= 0.7

    final = technical * tech_w + fund_raw * fund_w
    score = int(round(100 * max(0.0, min(1.0, final))))

    factors = []
    for key, weight in weights.items():
        if weight <= 0:
            continue  # not part of this setup's evidence, so not shown as a 0-weight row
        value, detail = raw[key]
        factors.append({
            "key": key, "label": FACTOR_LABELS[key],
            "weight": round(weight / weight_sum * tech_w, 4),
            "raw": round(value, 3), "score": int(round(value * 100)),
            "contribution": round(value * weight / weight_sum * tech_w * 100, 2),
            "detail": detail,
        })
    factors.append({
        "key": "fundamental", "label": "Fundamental bias",
        "weight": round(fund_w, 4), "raw": round(fund_raw, 3), "score": int(round(fund_raw * 100)),
        "contribution": round(fund_raw * fund_w * 100, 2),
        "detail": f"bias {bias} (score {bias_score:+.2f}) "
                  + ("- agrees with the trade" if fund_raw > 0.6
                     else "- neutral" if fund_raw == 0.5 else "- opposes the trade"),
    })
    factors.sort(key=lambda f: -f["contribution"])
    return {
        "score": score,
        "technical_score": int(round(technical * 100)),
        "fundamental_score": int(round(fund_raw * 100)),
        "technical_weight": round(tech_w, 2),
        "fundamental_weight": round(fund_w, 2),
        "factors": factors,
        "label": "strong" if score >= 80 else "decent" if score >= 65 else "marginal" if score >= 50 else "weak",
        "caveat": "Confluence score is a rule-based ranking, not a probability of profit.",
    }
