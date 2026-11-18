"""Candlestick patterns evaluated on closed bars only.

Each hit carries a base strength and the bar's relative volume. The signal
engine only upgrades a pattern when it forms at a meaningful level *and* has
volume confirmation - see signals/scoring.py.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class PatternHit:
    index: int
    name: str
    direction: str          # 'bull' | 'bear' | 'neutral'
    base_strength: float    # 0..1
    detail: str
    key_price: float        # pattern extreme, used for stop placement
    volume_ratio: float

    def dict(self) -> dict:
        return {"index": self.index, "name": self.name, "direction": self.direction,
                "base_strength": round(self.base_strength, 3), "detail": self.detail,
                "key_price": round(self.key_price, 6), "volume_ratio": round(self.volume_ratio, 2)}


def detect_patterns(
    open_: np.ndarray, high: np.ndarray, low: np.ndarray, close: np.ndarray,
    volume: np.ndarray, rel_volume: np.ndarray, atr: np.ndarray,
) -> dict[int, list[PatternHit]]:
    out: dict[int, list[PatternHit]] = {}
    n = len(close)
    rng = np.maximum(high - low, 1e-9)
    body = np.abs(close - open_)
    upper = high - np.maximum(open_, close)
    lower = np.minimum(open_, close) - low
    for i in range(2, n):
        hits: list[PatternHit] = []
        rv = float(rel_volume[i]) if np.isfinite(rel_volume[i]) else 1.0
        a = float(atr[i]) if np.isfinite(atr[i]) and atr[i] > 0 else float(rng[i])
        r = float(rng[i])
        b = float(body[i])
        lo_wick = float(lower[i])
        up_wick = float(upper[i])
        o, h, l, c = float(open_[i]), float(high[i]), float(low[i]), float(close[i])
        po, pc = float(open_[i - 1]), float(close[i - 1])

        # --- engulfing -----------------------------------------------------
        if pc < po and c > o and c >= po and o <= pc and b > abs(pc - po) * 0.9:
            hits.append(PatternHit(i, "Bullish engulfing", "bull", 0.62,
                                   f"Body engulfs prior down bar; close {c:.2f} above prior open {po:.2f}",
                                   l, rv))
        if pc > po and c < o and c <= po and o >= pc and b > abs(pc - po) * 0.9:
            hits.append(PatternHit(i, "Bearish engulfing", "bear", 0.62,
                                   f"Body engulfs prior up bar; close {c:.2f} below prior open {po:.2f}",
                                   h, rv))

        # --- pin bars / hammers / shooting stars ---------------------------
        if b <= r * 0.35 and lo_wick >= b * 2.0 and up_wick <= r * 0.35:
            hits.append(PatternHit(i, "Hammer / bull pin", "bull", 0.55,
                                   f"Long lower wick {lo_wick / max(r, 1e-9) * 100:.0f}% of range, close in upper half",
                                   l, rv))
        if b <= r * 0.35 and up_wick >= b * 2.0 and lo_wick <= r * 0.35:
            hits.append(PatternHit(i, "Shooting star / bear pin", "bear", 0.55,
                                   f"Long upper wick {up_wick / max(r, 1e-9) * 100:.0f}% of range, close in lower half",
                                   h, rv))

        # --- doji ----------------------------------------------------------
        if b <= r * 0.12 and r > a * 0.15:
            hits.append(PatternHit(i, "Doji", "neutral", 0.3,
                                   "Open and close nearly equal (indecision)", c, rv))

        # --- inside bar ----------------------------------------------------
        if h <= float(high[i - 1]) and l >= float(low[i - 1]):
            hits.append(PatternHit(i, "Inside bar", "neutral", 0.28,
                                   "Range contained inside the prior bar (compression)", c, rv))

        # --- 3-bar stars ---------------------------------------------------
        if i >= 2:
            b1 = abs(float(close[i - 2]) - float(open_[i - 2]))
            b2 = abs(float(close[i - 1]) - float(open_[i - 1]))
            mid1 = (float(open_[i - 2]) + float(close[i - 2])) / 2
            if (float(close[i - 2]) < float(open_[i - 2]) and b2 <= b1 * 0.5
                    and c > o and c > mid1 and b1 > a * 0.4):
                hits.append(PatternHit(i, "Morning star", "bull", 0.7,
                                       "Down bar, small-bodied pause, strong up close above the first body midpoint",
                                       float(low[i - 2]), rv))
            if (float(close[i - 2]) > float(open_[i - 2]) and b2 <= b1 * 0.5
                    and c < o and c < mid1 and b1 > a * 0.4):
                hits.append(PatternHit(i, "Evening star", "bear", 0.7,
                                       "Up bar, small-bodied pause, strong down close below the first body midpoint",
                                       float(high[i - 2]), rv))
        if hits:
            out[i] = hits
    return out


def best_pattern(hits: list[PatternHit], direction: str | None = None) -> PatternHit | None:
    if not hits:
        return None
    pool = [h for h in hits if direction is None or h.direction == direction]
    if not pool:
        return None
    return max(pool, key=lambda h: h.base_strength)
