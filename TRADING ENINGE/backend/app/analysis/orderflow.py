"""Order flow heuristics that require trade prints and/or depth.

Everything here is a *heuristic with evidence*, never a certainty:
  * footprint / delta                 <- tick trades
  * absorption                        <- trades (volume without price progress)
  * stacked imbalances                <- trades
  * probable iceberg                  <- depth refresh events
If the feed cannot supply the input, the function returns availability=False
and the reason, and callers must disable the dependent strategy.
"""
from __future__ import annotations

import numpy as np

from ..data.base import DepthEvent, Trade

# --------------------------------------------------------------------- delta


def delta_from_bars(frame, i: int) -> float | None:
    if frame.buy_volume is None or frame.sell_volume is None:
        return None
    return float(frame.buy_volume[i] - frame.sell_volume[i])


def delta_series(frame) -> np.ndarray | None:
    if frame.buy_volume is None or frame.sell_volume is None:
        return None
    return np.asarray(frame.buy_volume, dtype=float) - np.asarray(frame.sell_volume, dtype=float)


def cumulative_delta_from_bars(frame) -> np.ndarray | None:
    d = delta_series(frame)
    return None if d is None else np.cumsum(d)


# ----------------------------------------------------------------- footprint


def footprint(trades: list[Trade], tick: float, bin_ticks: int = 4) -> list[dict]:
    """Per-price bid/ask volume with diagonal imbalance flags."""
    if not trades:
        return []
    step = tick * bin_ticks
    buckets: dict[int, dict] = {}
    for t in trades:
        key = int(round(t.price / step))
        row = buckets.setdefault(key, {"buy": 0.0, "sell": 0.0, "trades": 0})
        if t.side > 0:
            row["buy"] += t.size
        elif t.side < 0:
            row["sell"] += t.size
        row["trades"] += 1
    rows = []
    keys = sorted(buckets)
    for idx, key in enumerate(keys):
        row = buckets[key]
        total = row["buy"] + row["sell"]
        ratio = (row["buy"] / total) if total > 0 else 0.5
        imbalance = None
        if total > 0:
            if ratio >= 0.72:
                imbalance = "buy"
            elif ratio <= 0.28:
                imbalance = "sell"
        rows.append({
            "price": round(key * step, 6),
            "buy_volume": round(row["buy"], 2),
            "sell_volume": round(row["sell"], 2),
            "total": round(total, 2),
            "delta": round(row["buy"] - row["sell"], 2),
            "imbalance": imbalance,
            "ratio": round(ratio, 3),
        })
    # stacked imbalances: 3+ consecutive same-side imbalances
    run = 0
    run_side = None
    for row in rows:
        side = row["imbalance"]
        if side and side == run_side:
            run += 1
        elif side:
            run, run_side = 1, side
        else:
            run, run_side = 0, None
        row["stacked"] = run >= 3
        if run == 3:
            row["stack_label"] = f"Stacked {run_side} imbalances (3 levels)"
    return rows


def stacked_imbalance_zones(rows: list[dict]) -> list[dict]:
    zones = []
    for row in rows:
        if row.get("stacked"):
            zones.append({"price": row["price"], "side": row["imbalance"],
                          "label": f"Stacked {row['imbalance']} imbalance at {row['price']}"})
    return zones


# ---------------------------------------------------------------- absorption


def absorption(
    open_: float, high: float, low: float, close: float, volume: float,
    atr: float, rel_volume: float, delta: float | None, tick: float,
) -> dict | None:
    """High effort, low result: large volume and delta, tiny range.

    Returns a heuristic dict with confidence + evidence, or None.
    """
    if atr <= 0:
        return None
    rng = max(high - low, tick)
    effort = rng / atr
    if rel_volume < 1.4 or effort > 0.55:
        return None
    if delta is None:
        return None
    body = abs(close - open_)
    conf = 0.4 + min(0.3, (rel_volume - 1.4) * 0.15) + (0.2 if effort < 0.35 else 0.0)
    conf += 0.1 if body < rng * 0.4 else 0.0
    direction = "bull" if delta > 0 else "bear"
    # Absorption of selling (positive delta, price held) suggests a bid defending.
    side = "bid" if delta > 0 else "ask"
    return {
        "price": round((high + low) / 2, 6),
        "zone_low": round(low, 6), "zone_high": round(high, 6),
        "side": side,
        "direction": direction,
        "confidence": round(min(0.9, conf), 3),
        "delta": round(delta, 2),
        "rel_volume": round(rel_volume, 2),
        "range_atr": round(effort, 2),
        "evidence": (
            f"{rel_volume:.1f}x volume with only {effort:.2f} ATR of range and "
            f"delta {delta:+.0f}: aggressive {'buying' if delta > 0 else 'selling'} "
            f"was absorbed near {((high + low) / 2):.2f}."
        ),
    }


# -------------------------------------------------------------------- iceberg


def icebergs(events: list[DepthEvent], tick: float, min_evidence: int = 3) -> list[dict]:
    """Probable icebergs from repeated fills far exceeding displayed size.

    Evidence count = number of refresh events at that price. Never labelled as
    certain: a large resting order that keeps refilling is an inference.
    """
    if not events:
        return []
    groups: dict[tuple[float, str], list[DepthEvent]] = {}
    for e in events:
        key = (round(e.price / tick), e.side)
        groups.setdefault(key, []).append(e)
    out = []
    for (price_key, side), evs in groups.items():
        displayed = float(np.mean([e.displayed for e in evs]))
        filled = float(np.sum([e.filled for e in evs]))
        refreshes = int(np.sum([e.refreshes for e in evs]))
        if refreshes < min_evidence or displayed <= 0:
            continue
        multiple = filled / displayed
        if multiple < 1.8:
            continue
        conf = min(0.92, 0.35 + 0.08 * refreshes + 0.05 * min(multiple, 6))
        out.append({
            "price": round(price_key * tick, 6),
            "side": side,
            "displayed": round(displayed, 2),
            "filled": round(filled, 2),
            "refreshes": refreshes,
            "fill_multiple": round(multiple, 2),
            "evidence_count": refreshes,
            "confidence": round(conf, 3),
            "label": f"Probable iceberg {side} @ {price_key * tick:.2f} ({refreshes} refills)",
            "evidence": (
                f"Filled {filled:.0f} contracts against ~{displayed:.0f} displayed "
                f"({multiple:.1f}x) across {refreshes} refresh events."
            ),
        })
    out.sort(key=lambda x: -x["confidence"])
    return out


# ----------------------------------------------------------------- aggregation


def snapshot(
    frame, i: int, trades: list[Trade] | None, depth_events: list[DepthEvent] | None,
    tick: float, bin_ticks: int = 4, min_evidence: int = 3,
) -> dict:
    """Order-flow bundle for one closed bar, with explicit availability flags."""
    delta = delta_from_bars(frame, i)
    cum = None
    if delta is not None:
        series = delta_series(frame)
        cum = float(np.nansum(series[:i + 1])) if series is not None else None
    rows = footprint(trades, tick, bin_ticks) if trades else []
    atr_val = None
    result = {
        "available": bool(trades or depth_events),
        "has_trades": bool(trades),
        "has_depth": bool(depth_events),
        "delta": None if delta is None else round(delta, 2),
        "cumulative_delta": None if cum is None else round(cum, 2),
        "footprint": rows[-120:],
        "stacked": stacked_imbalance_zones(rows),
        "icebergs": icebergs(depth_events or [], tick, min_evidence) if depth_events else [],
        "absorption": None,
        "reason": None if (trades or depth_events) else
        "Requires trade prints and/or depth data; this feed supplies candles only.",
    }
    return result
