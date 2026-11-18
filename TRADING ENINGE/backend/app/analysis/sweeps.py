"""Liquidity sweeps (stop runs): price takes a level out, then closes back inside.

Heuristic, not certainty. Every sweep reports the level, the penetration in
ticks/ATR, the close-back distance and the volume ratio as its evidence.
Detection is evaluated on the closed bar and only uses levels that were
already available before that bar.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Sweep:
    index: int
    direction: str       # 'bull' = swept lows then reclaimed (long bias)
    level: float
    level_kind: str
    level_label: str
    penetration: float   # price distance beyond the level
    penetration_atr: float
    close_back: float    # distance back inside the level
    volume_ratio: float
    reclaimed: bool
    confidence: float    # 0..1 heuristic confidence
    evidence: str

    def dict(self) -> dict:
        return {
            "index": self.index, "direction": self.direction, "level": round(self.level, 6),
            "level_kind": self.level_kind, "level_label": self.level_label,
            "penetration": round(self.penetration, 6),
            "penetration_atr": round(self.penetration_atr, 3),
            "close_back": round(self.close_back, 6),
            "volume_ratio": round(self.volume_ratio, 2), "reclaimed": self.reclaimed,
            "confidence": round(self.confidence, 3), "evidence": self.evidence,
        }


@dataclass
class LevelRef:
    price: float
    kind: str
    label: str
    available_index: int
    strength: float = 0.5


def detect_sweeps(
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    open_: np.ndarray,
    tick: float,
    atr: np.ndarray,
    rel_volume: np.ndarray,
    base_levels: dict[int, list[LevelRef]],
    swing_levels: list[LevelRef],
    td_index: np.ndarray,
) -> dict[int, list[Sweep]]:
    """Session levels become known at the session start; swing levels as they confirm."""
    out: dict[int, list[Sweep]] = {}
    n = len(close)
    active: list[LevelRef] = []
    last_td = -1
    si = 0
    swing_levels = sorted(swing_levels, key=lambda r: r.available_index)
    for i in range(1, n):
        td = int(td_index[i])
        if td != last_td:
            active = active + list(base_levels.get(td, []))
            last_td = td
        while si < len(swing_levels) and swing_levels[si].available_index <= i - 1:
            active.append(swing_levels[si])
            si += 1
        if len(active) > 80:
            active = active[-80:]
        a = float(atr[i - 1]) if np.isfinite(atr[i - 1]) and atr[i - 1] > 0 else tick * 4
        rv = float(rel_volume[i]) if np.isfinite(rel_volume[i]) else 1.0
        h, l, c = float(high[i]), float(low[i]), float(close[i])
        best_hi = None
        best_lo = None
        if rv < 1.0 or (h - l) < a * 0.30:
            continue
        # only material, still-relevant levels qualify as sweep candidates
        candidates = [r for r in active
                      if r.strength >= 0.3 and (r.available_index >= i - 150 or r.strength >= 0.65)]
        min_pen = tick * 1.5
        for ref in candidates:
            if ref.available_index >= i:
                continue
            # sweep of a high: traded above, closed back below
            if h > ref.price + min_pen and c < ref.price - tick * 0.5:
                pen = h - ref.price
                if pen <= a * 1.6 and (best_hi is None or pen < best_hi[0]):
                    best_hi = (pen, ref, c)
            if l < ref.price - min_pen and c > ref.price + tick * 0.5:
                pen = ref.price - l
                if pen <= a * 1.6 and (best_lo is None or pen < best_lo[0]):
                    best_lo = (pen, ref, c)
        hits: list[Sweep] = []
        if best_hi is not None:
            pen, ref, cpx = best_hi
            pen_atr = pen / a
            close_back = ref.price - cpx
            conf = 0.35 + 0.25 * min(1.0, close_back / max(a * 0.5, tick))
            conf += 0.2 if rv >= 1.3 else 0.0
            conf += 0.15 if pen_atr <= 0.5 else 0.0
            hits.append(Sweep(
                index=i, direction="bear", level=ref.price, level_kind=ref.kind, level_label=ref.label,
                penetration=pen, penetration_atr=pen_atr, close_back=close_back, volume_ratio=rv,
                reclaimed=True, confidence=float(min(0.95, conf)),
                evidence=(f"High {h:.2f} took out {ref.label} at {ref.price:.2f} by "
                          f"{int(round(pen / tick))} ticks ({pen_atr:.2f} ATR), closed back "
                          f"{int(round(close_back / tick))} ticks inside on {rv:.1f}x volume."),
            ))
        if best_lo is not None:
            pen, ref, cpx = best_lo
            pen_atr = pen / a
            close_back = cpx - ref.price
            conf = 0.35 + 0.25 * min(1.0, close_back / max(a * 0.5, tick))
            conf += 0.2 if rv >= 1.3 else 0.0
            conf += 0.15 if pen_atr <= 0.5 else 0.0
            hits.append(Sweep(
                index=i, direction="bull", level=ref.price, level_kind=ref.kind, level_label=ref.label,
                penetration=pen, penetration_atr=pen_atr, close_back=close_back, volume_ratio=rv,
                reclaimed=True, confidence=float(min(0.95, conf)),
                evidence=(f"Low {l:.2f} took out {ref.label} at {ref.price:.2f} by "
                          f"{int(round(pen / tick))} ticks ({pen_atr:.2f} ATR), closed back "
                          f"{int(round(close_back / tick))} ticks inside on {rv:.1f}x volume."),
            ))
        if hits:
            out[i] = hits
    return out
