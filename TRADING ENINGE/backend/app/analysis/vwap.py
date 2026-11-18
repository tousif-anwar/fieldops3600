"""VWAP with standard-deviation bands, session-anchored and custom-anchored."""
from __future__ import annotations

import numpy as np


def vwap_series(
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    volume: np.ndarray,
    session_ids: np.ndarray,
    bands: tuple[float, ...] = (1.0, 2.0),
) -> dict[str, np.ndarray]:
    """Session-anchored VWAP + weighted std bands, reset at each session change."""
    n = len(close)
    vwap = np.full(n, np.nan)
    sd = np.full(n, np.nan)
    typical = (high + low + close) / 3.0
    pv_sum = 0.0
    vol_sum = 0.0
    p2_sum = 0.0
    current = None
    for i in range(n):
        sid = int(session_ids[i])
        if sid != current:
            current = sid
            pv_sum = vol_sum = p2_sum = 0.0
        v = float(volume[i])
        if v <= 0:
            v = 1e-9
        p = float(typical[i])
        pv_sum += p * v
        p2_sum += p * p * v
        vol_sum += v
        if vol_sum > 0:
            mean = pv_sum / vol_sum
            var = max(p2_sum / vol_sum - mean * mean, 0.0)
            vwap[i] = mean
            sd[i] = float(np.sqrt(var))
    out: dict[str, np.ndarray] = {"vwap": vwap, "sd": sd}
    for k in bands:
        tag = int(k) if float(k).is_integer() else k
        out[f"upper{tag}"] = vwap + k * sd
        out[f"lower{tag}"] = vwap - k * sd
    return out


def anchored_vwap(
    high: np.ndarray, low: np.ndarray, close: np.ndarray, volume: np.ndarray, anchor: int
) -> dict[str, np.ndarray]:
    """VWAP anchored at `anchor` (e.g. the session open, a swing high or a news bar)."""
    n = len(close)
    vwap = np.full(n, np.nan)
    sd = np.full(n, np.nan)
    typical = (high + low + close) / 3.0
    pv = p2 = vv = 0.0
    for i in range(max(0, anchor), n):
        v = max(float(volume[i]), 1e-9)
        p = float(typical[i])
        pv += p * v
        p2 += p * p * v
        vv += v
        mean = pv / vv
        vwap[i] = mean
        sd[i] = float(np.sqrt(max(p2 / vv - mean * mean, 0.0)))
    return {"vwap": vwap, "sd": sd, "upper1": vwap + sd, "lower1": vwap - sd,
            "upper2": vwap + 2 * sd, "lower2": vwap - 2 * sd}


def vwap_z(price: float, vwap: float, sd: float) -> float:
    if not np.isfinite(vwap) or not np.isfinite(sd) or sd <= 0:
        return 0.0
    return float((price - vwap) / sd)
