"""Market structure: swings, HH/HL/LH/LL state, break of structure, change of character.

Look-ahead safety: a pivot at index p needs `right` bars *after* p to be valid,
so it becomes available at index p+right (`confirmed_index`). Structure events
are stamped at the bar that confirmed them. Nothing here can see the future of
the bar it is evaluated on.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Swing:
    index: int
    price: float
    kind: str            # 'high' | 'low'
    confirmed_index: int
    strength: float      # 0..1, based on prominence vs ATR

    def dict(self) -> dict:
        return {"index": self.index, "price": round(self.price, 6), "kind": self.kind,
                "confirmed_index": self.confirmed_index, "strength": round(self.strength, 3)}


@dataclass(frozen=True)
class StructureEvent:
    index: int
    kind: str            # 'BOS' | 'CHoCH'
    direction: str       # 'bull' | 'bear'
    level: float
    swing_index: int
    label: str

    def dict(self) -> dict:
        return {"index": self.index, "kind": self.kind, "direction": self.direction,
                "level": round(self.level, 6), "swing_index": self.swing_index, "label": self.label}


def find_swings(
    high: np.ndarray, low: np.ndarray, atr: np.ndarray, left: int = 3, right: int = 3,
    max_swings: int | None = None,
) -> list[Swing]:
    n = len(high)
    swings: list[Swing] = []
    if n < left + right + 2:
        return swings
    for p in range(left, n - right):
        window_h = high[p - left:p + right + 1]
        window_l = low[p - left:p + right + 1]
        a = float(atr[p]) if np.isfinite(atr[p]) and atr[p] > 0 else 1.0
        if high[p] >= window_h.max() - 1e-12:
            neighbours = np.delete(window_h, left)
            prominence = (float(high[p]) - float(neighbours.max())) / a
            swings.append(Swing(p, float(high[p]), "high", p + right,
                                float(max(0.0, min(1.0, prominence / 1.5)))))
        if low[p] <= window_l.min() + 1e-12:
            neighbours = np.delete(window_l, left)
            prominence = (float(neighbours.min()) - float(low[p])) / a
            swings.append(Swing(p, float(low[p]), "low", p + right,
                                float(max(0.0, min(1.0, prominence / 1.5)))))
    # ordered by index, which is also confirm-time order (right is constant)
    swings.sort(key=lambda s: (s.index, s.kind))
    return swings[-max_swings:] if max_swings else swings


def build_structure(swings: list[Swing], close: np.ndarray) -> list[StructureEvent]:
    """Walk closed bars, tracking the last confirmed swing on each side.

    * close beyond the last confirmed swing high/low in the direction of the
      prevailing trend -> BOS
    * close beyond it against the prevailing trend         -> CHoCH
    """
    events: list[StructureEvent] = []
    if not swings:
        return events
    by_confirm = sorted(swings, key=lambda s: s.confirmed_index)
    last_high: Swing | None = None
    last_low: Swing | None = None
    trend = 0  # +1 bull, -1 bear, 0 unknown
    si = 0
    n = len(close)
    for i in range(n):
        while si < len(by_confirm) and by_confirm[si].confirmed_index <= i:
            s = by_confirm[si]
            if s.kind == "high":
                last_high = s
            else:
                last_low = s
            si += 1
        price = float(close[i])
        if last_high is not None and price > last_high.price:
            direction = "bull"
            kind = "BOS" if trend >= 0 else "CHoCH"
            events.append(StructureEvent(i, kind, direction, last_high.price, last_high.index,
                                         f"{'Bullish' if direction == 'bull' else 'Bearish'} {kind} above {last_high.price:.2f}"))
            trend = 1
            last_high = None
        if last_low is not None and price < last_low.price:
            direction = "bear"
            kind = "BOS" if trend <= 0 else "CHoCH"
            events.append(StructureEvent(i, kind, direction, last_low.price, last_low.index,
                                         f"{'Bearish' if direction == 'bear' else 'Bullish'} {kind} below {last_low.price:.2f}"))
            trend = -1
            last_low = None
    return events


def trend_at(
    swings: list[Swing], events: list[StructureEvent], index: int,
    swing_confirm_times: np.ndarray | None = None,
    event_times: np.ndarray | None = None,
) -> dict:
    """Structure state using only data confirmed at or before `index`."""
    if swing_confirm_times is not None and len(swing_confirm_times):
        k = int(np.searchsorted(swing_confirm_times, index, side="right"))
    else:
        k = len([s for s in swings if s.confirmed_index <= index])
    # walk backwards collecting the 4 most recent highs and lows (bounded work)
    highs: list[Swing] = []
    lows: list[Swing] = []
    j = k - 1
    while j >= 0 and (len(highs) < 4 or len(lows) < 4):
        s = swings[j]
        if s.kind == "high" and len(highs) < 4:
            highs.append(s)
        elif s.kind == "low" and len(lows) < 4:
            lows.append(s)
        j -= 1
    highs.reverse()
    lows.reverse()
    if event_times is not None and len(event_times):
        ek = int(np.searchsorted(event_times, index, side="right"))
        last_event = events[ek - 1] if ek > 0 else None
    else:
        evs = [e for e in events if e.index <= index]
        last_event = evs[-1] if evs else None

    def pattern(points: list[Swing]) -> str | None:
        if len(points) < 2:
            return None
        a, b = points[-2].price, points[-1].price
        if b > a:
            return "HH" if points is highs else "HL"
        if b < a:
            return "LH" if points is highs else "LL"
        return "EQ"

    high_state = pattern(highs)
    low_state = pattern(lows)
    state = "range"
    if high_state in {"HH"} and low_state in {"HL"}:
        state = "uptrend"
    elif high_state in {"LH"} and low_state in {"LL"}:
        state = "downtrend"
    elif high_state == "HH" or low_state == "HL":
        state = "bullish_bias"
    elif high_state == "LH" or low_state == "LL":
        state = "bearish_bias"

    if last_event and last_event.index == index and last_event.kind == "CHoCH":
        state = "choch_bull" if last_event.direction == "bull" else "choch_bear"

    score = {"uptrend": 1.0, "bullish_bias": 0.6, "choch_bull": 0.55, "range": 0.0,
             "bearish_bias": -0.6, "choch_bear": -0.55, "downtrend": -1.0}[state]
    return {
        "state": state,
        "score": score,
        "high_state": high_state,
        "low_state": low_state,
        "last_swing_high": highs[-1].dict() if highs else None,
        "last_swing_low": lows[-1].dict() if lows else None,
        "last_event": last_event.dict() if last_event else None,
        "swing_highs": [s.dict() for s in highs],
        "swing_lows": [s.dict() for s in lows],
        "confirmed_swing_count": k,
    }


def equal_levels(swings: list[Swing], tick: float, tolerance_ticks: int = 2) -> list[dict]:
    """Equal highs / equal lows (liquidity resting above/below).

    Deliberately anchored on the *first two* touching swings only: the level and
    its availability index therefore never change when later swings appear.
    That keeps the level identical in a truncated (causal) replay, and stops a
    future third touch from retroactively moving a past level.
    """
    out: list[dict] = []
    tol = tick * tolerance_ticks
    for kind in ("high", "low"):
        pts = [s for s in swings if s.kind == kind]
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            if a.index == b.index:
                continue
            if abs(b.price - a.price) <= tol:
                out.append({
                    "kind": f"equal_{kind}s",
                    "price": round((a.price + b.price) / 2, 6),
                    "count": 2,
                    "indices": [a.index, b.index],
                    "last_confirmed": max(a.confirmed_index, b.confirmed_index),
                    "label": f"Equal {'highs' if kind == 'high' else 'lows'}",
                })
    return out
