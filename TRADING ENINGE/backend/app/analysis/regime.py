"""Volatility / trend regime. Strategies are activated by regime, not just score."""
from __future__ import annotations

import numpy as np

from . import indicators as ind


def classify(
    high: np.ndarray, low: np.ndarray, close: np.ndarray, volume: np.ndarray,
    atr_period: int = 14, rank_window: int = 200,
) -> dict[str, np.ndarray]:
    atr_ = ind.atr(high, low, close, atr_period)
    atr_rank = ind.percentile_rank(atr_, rank_window)
    adx_, plus_di, minus_di = ind.adx(high, low, close, 14)
    er = ind.efficiency_ratio(close, 20)
    vr = ind.variance_ratio(close, 100, 5)
    ema50 = ind.ema(close, 50)
    ema200 = ind.ema(close, 200)
    n = len(close)
    vol_regime = np.empty(n, dtype=object)
    trend_regime = np.empty(n, dtype=object)
    direction = np.empty(n, dtype=object)
    for i in range(n):
        r = atr_rank[i]
        if not np.isfinite(r):
            vol_regime[i] = "unknown"
        elif r < 25:
            vol_regime[i] = "compressed"
        elif r < 75:
            vol_regime[i] = "normal"
        elif r < 95:
            vol_regime[i] = "expanded"
        else:
            vol_regime[i] = "extreme"
        a, e = adx_[i], er[i]
        if not np.isfinite(a) or not np.isfinite(e):
            trend_regime[i] = "unknown"
        elif a >= 23 and e >= 0.30:
            trend_regime[i] = "trending"
        elif a < 18 or e < 0.16:
            trend_regime[i] = "ranging"
        else:
            trend_regime[i] = "transitional"
        f50, f200 = ema50[i], ema200[i]
        if not np.isfinite(f50) or not np.isfinite(f200):
            direction[i] = "unknown"
        else:
            direction[i] = "up" if f50 > f200 else "down"
    return {
        "atr": atr_, "atr_rank": atr_rank, "adx": adx_, "plus_di": plus_di, "minus_di": minus_di,
        "er": er, "vr": vr, "ema50": ema50, "ema200": ema200,
        "vol_regime": vol_regime, "trend_regime": trend_regime, "direction": direction,
    }


def snapshot(reg: dict[str, np.ndarray], i: int, price: float | None = None) -> dict:
    def val(key, default=None):
        arr = reg.get(key)
        if arr is None or i >= len(arr):
            return default
        v = arr[i]
        if isinstance(v, float) and not np.isfinite(v):
            return default
        return v

    vol = val("vol_regime", "unknown")
    trend = val("trend_regime", "unknown")
    atr_pct = val("atr_rank")
    adx_ = val("adx")
    er = val("er")
    vr = val("vr")
    persistence = (
        "unknown" if vr is None else
        "trending" if vr > 1.10 else
        "mean_reverting" if vr < 0.90 else
        "random_walk"
    )
    if trend == "trending":
        mode = "momentum"
    elif trend == "ranging":
        mode = "mean_reversion"
    else:
        mode = "both"
    if vol in {"extreme", "compressed"} and mode == "momentum":
        mode = "both"
    return {
        "vol_regime": vol,
        "trend_regime": trend,
        "direction": val("direction", "unknown"),
        "atr": round(float(val("atr", 0) or 0), 6),
        "atr_percentile": round(float(atr_pct), 1) if atr_pct is not None else None,
        "adx": round(float(adx_), 1) if adx_ is not None else None,
        "efficiency_ratio": round(float(er), 2) if er is not None else None,
        "variance_ratio": round(float(vr), 3) if vr is not None else None,
        "persistence": persistence,
        "strategy_mode": mode,
        "label": f"{str(trend).replace('_', ' ')} / {vol} volatility",
        "size_multiplier": 0.5 if vol == "extreme" else 1.0,
        "reason": (
            f"ADX {float(adx_):.0f} and efficiency {float(er):.2f} -> {trend}; "
            f"ATR at the {float(atr_pct):.0f}th percentile -> {vol} volatility"
            + (f"; variance ratio {float(vr):.2f} -> {persistence.replace('_', ' ')}."
               if vr is not None else ".")
            if adx_ is not None and er is not None and atr_pct is not None
            else "Regime not yet measurable (not enough history)."
        ),
    }


def strategy_allowed(regime: dict, family: str) -> tuple[bool, str]:
    """Switch active strategy families by regime (momentum vs mean reversion).

    A transitional regime is genuinely ambiguous from ADX and efficiency alone,
    so the variance ratio decides there: it measures autocorrelation directly
    (VR < 1 mean reverting, VR > 1 trending).
    """
    mode = regime.get("strategy_mode", "both")
    trend = regime.get("trend_regime")
    persistence = regime.get("persistence", "unknown")
    if family == "momentum":
        if mode == "mean_reversion" or trend == "ranging":
            return False, "ranging regime, so momentum setups are disabled"
        if trend == "transitional" and persistence == "mean_reverting":
            return False, "transitional regime with a mean-reverting variance ratio, so breakouts are disabled"
        return True, "trending regime supports momentum"
    if family == "contra_trend":
        if trend == "trending" and regime.get("direction") in {"up", "down"}:
            return False, "strong trend, so counter-trend fades are disabled"
        if trend == "transitional" and persistence == "trending":
            return False, "transitional regime with a trending variance ratio, so fades are disabled"
        return True, "range/transition regime supports mean reversion"
    return True, "neutral"
