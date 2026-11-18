"""Volume profile: session / daily / weekly / composite, POC, value area, naked POCs.

Candles do not contain intrabar volume-at-price, so volume is distributed
evenly across each bar's high-low range. That is the standard candle-based
approximation and is labelled as such in the UI.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass
class Profile:
    label: str
    low: float
    high: float
    step: float
    bins: list[float]
    poc: float
    vah: float
    val: float
    total_volume: float
    value_area_fraction: float
    buckets_low: list[float] = field(default_factory=list)
    high_volume_nodes: list[float] = field(default_factory=list)
    low_volume_nodes: list[float] = field(default_factory=list)
    naked: bool = False
    start_ts: float = 0.0
    end_ts: float = 0.0

    def dict(self) -> dict:
        return {
            "label": self.label, "low": round(self.low, 6), "high": round(self.high, 6),
            "step": self.step, "poc": round(self.poc, 6), "vah": round(self.vah, 6),
            "val": round(self.val, 6), "total_volume": round(self.total_volume, 2),
            "value_area_fraction": self.value_area_fraction,
            "bins": [round(float(x), 2) for x in self.bins],
            "buckets_low": [round(float(x), 6) for x in self.buckets_low],
            "hvns": [round(float(x), 6) for x in self.high_volume_nodes],
            "lvns": [round(float(x), 6) for x in self.low_volume_nodes],
            "naked": self.naked, "start_ts": int(self.start_ts), "end_ts": int(self.end_ts),
            "method": "candle-range distributed",
        }


def _bucket_index(prices: np.ndarray, low: float, step: float, size: int) -> np.ndarray:
    idx = np.floor((prices - low) / step).astype(np.int64)
    return np.clip(idx, 0, size - 1)


def build_profile(
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    volume: np.ndarray,
    tick: float,
    label: str = "session",
    value_area: float = 0.70,
    bin_ticks: int = 2,
    start_ts: float = 0.0,
    end_ts: float = 0.0,
) -> Profile | None:
    """Build a volume-at-price histogram from candles."""
    if len(high) == 0:
        return None
    lo = float(np.min(low))
    hi = float(np.max(high))
    if not np.isfinite(lo) or not np.isfinite(hi) or hi <= lo:
        return None
    step = max(tick * bin_ticks, (hi - lo) / 400.0)
    size = int(np.ceil((hi - lo) / step)) + 1
    size = min(max(size, 4), 400)
    hist = np.zeros(size, dtype=np.float64)
    for i in range(len(high)):
        b_lo = int(np.floor((float(low[i]) - lo) / step))
        b_hi = int(np.floor((float(high[i]) - lo) / step))
        b_lo = max(0, min(b_lo, size - 1))
        b_hi = max(b_lo, min(b_hi, size - 1))
        bins = b_hi - b_lo + 1
        hist[b_lo:b_hi + 1] += float(volume[i]) / bins
    total = float(hist.sum())
    if total <= 0:
        return None
    poc_idx = int(np.argmax(hist))
    # expand around the POC until `value_area` of the volume is covered
    lower = upper = poc_idx
    covered = float(hist[poc_idx])
    target = total * value_area
    while covered < target and (lower > 0 or upper < size - 1):
        down = hist[lower - 1] if lower > 0 else -1.0
        up = hist[upper + 1] if upper < size - 1 else -1.0
        if up >= down:
            upper += 1
            covered += float(hist[upper])
        else:
            lower -= 1
            covered += float(hist[lower])
    center = lo + (np.arange(size) + 0.5) * step
    # HVN / LVN: local extrema of the histogram (meaningful only with enough bins)
    hvns, lvns = [], []
    if size >= 9:
        smooth = np.convolve(hist, np.ones(3) / 3.0, mode="same")
        for k in range(2, size - 2):
            window = smooth[k - 2:k + 3]
            if smooth[k] == window.max() and smooth[k] > smooth.mean() * 1.15:
                hvns.append(float(center[k]))
            elif smooth[k] == window.min() and smooth[k] < smooth.mean() * 0.6:
                lvns.append(float(center[k]))
    return Profile(
        label=label, low=lo, high=hi, step=step, bins=hist.tolist(),
        poc=float(center[poc_idx]), vah=float(center[upper]), val=float(center[lower]),
        total_volume=total, value_area_fraction=value_area,
        buckets_low=center.tolist(), high_volume_nodes=hvns[:6], low_volume_nodes=lvns[:6],
        start_ts=start_ts, end_ts=end_ts,
    )


def in_value_area(price: float, profile: Profile) -> bool:
    return profile.val <= price <= profile.vah


def value_position(price: float, profile: Profile) -> str:
    if price > profile.vah:
        return "above_value"
    if price < profile.val:
        return "below_value"
    return "in_value"


def naked_pocs(profiles: list[Profile], after_price_high: np.ndarray, after_price_low: np.ndarray) -> list[float]:
    """POCs from completed sessions that price has not traded back through since."""
    out = []
    for idx, prof in enumerate(profiles):
        if idx + 1 >= len(profiles):
            continue
        later_hi = after_price_high[idx + 1:]
        later_lo = after_price_low[idx + 1:]
        if len(later_hi) == 0:
            continue
        if prof.poc > later_hi.max() or prof.poc < later_lo.min():
            out.append(round(prof.poc, 6))
    return out
