"""Key levels: sessions, value areas, swings, round numbers and supply/demand zones."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

LEVEL_COLORS = {
    "pdh": "#f97316", "pdl": "#f97316", "pdc": "#fb923c",
    "pwh": "#a855f7", "pwl": "#a855f7", "pmh": "#c084fc", "pml": "#c084fc",
    "onh": "#38bdf8", "onl": "#38bdf8", "orh": "#22d3ee", "orl": "#22d3ee",
    "poc": "#eab308", "vah": "#eab308", "val": "#eab308", "naked_poc": "#facc15",
    "round": "#94a3b8", "swing": "#64748b", "equal_highs": "#f43f5e", "equal_lows": "#10b981",
    "zone": "#fb7185", "hvn": "#8b5cf6", "lvn": "#0ea5e9",
    "pivot_pp": "#a3a3a3", "pivot_r1": "#f87171", "pivot_r2": "#fb7185", "pivot_r3": "#fda4af",
    "pivot_s1": "#4ade80", "pivot_s2": "#34d399", "pivot_s3": "#6ee7b7",
}


def nice_step(x: float) -> float:
    steps = [0.25, 0.5, 1, 2, 2.5, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]
    for s in steps:
        if s >= x:
            return float(s)
    return float(steps[-1])


def round_number_levels(price: float, tick: float, count: int = 2) -> list[dict]:
    step = max(nice_step(price * 0.005), tick * 4)
    base = round(price / step) * step
    out = []
    for k in range(-count, count + 1):
        p = base + k * step
        if p <= 0:
            continue
        out.append({
            "price": float(round(p, 6)),
            "label": f"Round {p:,.0f}" if step >= 1 else f"Round {p:g}",
            "kind": "round",
            "strength": 0.45 if k == 0 else 0.38,
            "detail": f"{step:g}-point round number",
            "group": "round",
        })
    return out


@dataclass(frozen=True)
class Zone:
    low: float
    high: float
    kind: str                 # 'demand' | 'supply'
    created_index: int
    available_index: int
    mitigated_index: int | None
    label: str
    detail: str
    strength: float

    def dict(self, price: float | None = None, i: int | None = None) -> dict:
        active = self.mitigated_index is None or (i is not None and i < self.mitigated_index)
        d = {
            "low": round(self.low, 6), "high": round(self.high, 6), "kind": self.kind,
            "label": self.label, "detail": self.detail, "strength": round(self.strength, 2),
            "created_index": self.created_index, "active": active,
            "color": "#10b981" if self.kind == "demand" else "#f43f5e",
        }
        if price is not None:
            d["contains_price"] = self.low <= price <= self.high
        return d


def order_blocks(
    open_: np.ndarray, high: np.ndarray, low: np.ndarray, close: np.ndarray,
    events: list, lookback: int = 8,
) -> list[Zone]:
    """Last opposite-colour candle before a displacement break = order block."""
    zones: list[Zone] = []
    n = len(close)
    for ev in events:
        e = ev.index
        if e < 3 or e >= n:
            continue
        if ev.direction == "bull":
            pick = None
            for j in range(e - 1, max(0, e - lookback) - 1, -1):
                if close[j] < open_[j]:
                    pick = j
                    break
            if pick is None:
                continue
            zl, zh = float(low[pick]), float(high[pick])
            kind, label = "demand", f"Demand zone (bullish {ev.kind})"
        else:
            pick = None
            for j in range(e - 1, max(0, e - lookback) - 1, -1):
                if close[j] > open_[j]:
                    pick = j
                    break
            if pick is None:
                continue
            zl, zh = float(low[pick]), float(high[pick])
            kind, label = "supply", f"Supply zone (bearish {ev.kind})"
        if zh <= zl:
            continue
        # mitigation: first later bar that trades fully through the zone
        mitigated = None
        if kind == "demand":
            breach = np.flatnonzero(low[e + 1:] < zl)
        else:
            breach = np.flatnonzero(high[e + 1:] > zh)
        if len(breach):
            mitigated = int(e + 1 + breach[0])
        zones.append(Zone(
            low=zl, high=zh, kind=kind, created_index=pick, available_index=e,
            mitigated_index=mitigated, label=label,
            detail=(f"Last {'down' if kind == 'demand' else 'up'} candle before the "
                    f"{ev.kind} at {ev.level:.2f} (impulse displacement)."),
            strength=0.55 + (0.15 if ev.kind == "BOS" else 0.0) + min(0.15, (zh - zl) / max(zh, 1e-9) * 20),
        ))
    zones.sort(key=lambda z: (z.available_index, z.kind))
    return zones


def assemble(prep: Any, i: int, profile: Any | None = None) -> list[dict]:
    """All levels known at bar `i`, with strength, group and distance."""
    inst = prep.inst
    frame = prep.frame
    tick = inst.tick_size
    price = float(frame.close[i])
    td = int(prep.td_index[i])
    out: list[dict] = []
    seen: dict[tuple[str, int], int] = {}

    def add(kind: str, label: str, value: float | None, strength: float, detail: str,
            group: str, tags: list[str] | None = None, extra: dict | None = None) -> None:
        if value is None or not np.isfinite(value) or value <= 0:
            return
        p = inst.round_tick(float(value))
        key = (kind, int(round(p / tick)))
        if key in seen:
            existing = out[seen[key]]
            existing["strength"] = round(min(0.99, max(existing["strength"], strength) + 0.05), 3)
            for t in tags or []:
                if t not in existing["tags"]:
                    existing["tags"].append(t)
            return
        row = {
            "id": f"{kind}-{key[1]}",
            "kind": kind,
            "label": label,
            "price": p,
            "strength": round(float(strength), 3),
            "detail": detail,
            "group": group,
            "tags": tags or [],
            "color": LEVEL_COLORS.get(kind, "#94a3b8"),
            "distance_ticks": int(round((price - p) / tick)),
            "side": "above" if p > price else "below",
        }
        if extra:
            row.update(extra)
        seen[key] = len(out)
        out.append(row)

    prior = prep.prior.get(td, {})
    # ---- prior periods -----------------------------------------------------
    for key, label, strength, group in (
        ("pdh", "Prior day high", 0.95, "session"), ("pdl", "Prior day low", 0.95, "session"),
        ("pdc", "Prior day close", 0.7, "session"),
        ("pwh", "Prior week high", 0.85, "session"), ("pwl", "Prior week low", 0.85, "session"),
        ("pmh", "Prior month high", 0.8, "session"), ("pml", "Prior month low", 0.8, "session"),
    ):
        day_date = prior.get("pd_date") if key.startswith(("pdh", "pdl", "pdc")) else None
        detail = f"{label} from the completed period" + (f" ({day_date})." if day_date else ".")
        add(key, label, prior.get(key), strength, detail, group, tags=["prior_session"])

    # ---- floor pivots from the completed session ---------------------------
    # The classic day-trading reference set for index futures: PP plus three
    # resistance and three support bands, all from the prior session's H/L/C.
    pdh, pdl, pdc = prior.get("pdh"), prior.get("pdl"), prior.get("pdc")
    if pdh and pdl and pdc:
        pp = (pdh + pdl + pdc) / 3.0
        day_range = pdh - pdl
        pivot_rows = (
            ("pivot_pp", "Pivot PP", pp, 0.8, "the central pivot"),
            ("pivot_r1", "R1", 2 * pp - pdl, 0.66, "first resistance"),
            ("pivot_r2", "R2", pp + day_range, 0.6, "second resistance"),
            ("pivot_r3", "R3", pdh + 2 * (pp - pdl), 0.52, "third resistance"),
            ("pivot_s1", "S1", 2 * pp - pdh, 0.66, "first support"),
            ("pivot_s2", "S2", pp - day_range, 0.6, "second support"),
            ("pivot_s3", "S3", pdl - 2 * (pdh - pp), 0.52, "third support"),
        )
        for kind, label, value, strength, role in pivot_rows:
            add(kind, label, value, strength,
                f"Floor pivot {label} ({role}) from the {prior.get('pd_date') or 'prior'} "
                f"session high {pdh:.2f}, low {pdl:.2f}, close {pdc:.2f}.",
                "pivot", tags=["pivot", "floor"])

    # ---- overnight / opening range (developing flags while incomplete) -----
    on_h = float(prep.on_high_run[i]) if np.isfinite(prep.on_high_run[i]) else None
    on_l = float(prep.on_low_run[i]) if np.isfinite(prep.on_low_run[i]) else None
    on_complete = bool(prep.is_rth[i])
    if on_h and on_l:
        add("onh", "Overnight high" + ("" if on_complete else " (developing)"), on_h, 0.66,
            "Globex high from 18:00 ET to the RTH open." if on_complete else
            "Developing Globex high (session still in progress).", "session",
            tags=["overnight"])
        add("onl", "Overnight low" + ("" if on_complete else " (developing)"), on_l, 0.66,
            "Globex low from 18:00 ET to the RTH open." if on_complete else
            "Developing Globex low (session still in progress).", "session",
            tags=["overnight"])
    orh = float(prep.or_high_run[i]) if np.isfinite(prep.or_high_run[i]) else None
    orl = float(prep.or_low_run[i]) if np.isfinite(prep.or_low_run[i]) else None
    if orh and orl:
        add("orh", "Opening range high", orh, 0.62,
            f"High of the first {prep.orb_minutes} minutes of RTH.", "session", tags=["opening_range"])
        add("orl", "Opening range low", orl, 0.62,
            f"Low of the first {prep.orb_minutes} minutes of RTH.", "session", tags=["opening_range"])
    if np.isfinite(prep.rth_open_price[i]):
        add("rth_open", "RTH open", float(prep.rth_open_price[i]), 0.55,
            "Regular-session open. Reference for gap and opening-drive logic.", "session",
            tags=["rth_open"])

    # ---- value areas -------------------------------------------------------
    cur = profile if profile is not None else prep.current_profile(i)
    if cur is not None:
        add("poc", "Session POC (developing)", cur.poc, 0.78,
            f"Developing session point of control, {cur.total_volume:,.0f} contracts traded.", "profile",
            tags=["developing", "value_area"])
        add("vah", "Session VAH (developing)", cur.vah, 0.7,
            "Upper bound of the developing 70% value area.", "profile", tags=["developing"])
        add("val", "Session VAL (developing)", cur.val, 0.7,
            "Lower bound of the developing 70% value area.", "profile", tags=["developing"])
    prior_prof = prep.prior_profiles.get(td)
    if prior_prof is not None:
        add("poc", "Prior day POC", prior_prof.poc, 0.85,
            "Point of control of the previous completed session.", "profile",
            tags=["prior_session", "value_area"])
        add("vah", "Prior day VAH", prior_prof.vah, 0.72, "Prior-day value area high.", "profile",
            tags=["prior_session"])
        add("val", "Prior day VAL", prior_prof.val, 0.72, "Prior-day value area low.", "profile",
            tags=["prior_session"])
    comp = prep.composite_profile_for(td)
    if comp is not None:
        for hvn in comp.high_volume_nodes[:3]:
            add("hvn", "High-volume node", hvn, 0.55,
                "Composite profile node with elevated traded volume.", "profile", tags=["composite"])
        for lvn in comp.low_volume_nodes[:3]:
            add("lvn", "Low-volume node", lvn, 0.45,
                "Composite profile node where price moved quickly (thin liquidity).", "profile",
                tags=["composite"])
    for npoc in prep.naked_pocs(td):
        add("naked_poc", "Naked POC", npoc, 0.68,
            "POC of a completed session that price has not traded back through since.", "profile",
            tags=["naked"])

    # ---- structure ---------------------------------------------------------
    confirmed = [s for s in prep.swings if s.confirmed_index <= i and s.index >= i - prep.swing_lookback]
    for s in confirmed[-10:]:
        add("swing", f"Swing {'high' if s.kind == 'high' else 'low'}", s.price,
            0.42 + 0.3 * s.strength,
            f"Confirmed pivot {int(i - s.index)} bars ago (bar {s.index}), prominence {s.strength:.2f} ATR.",
            "structure", tags=["swing", s.kind])
    for eq in prep.equal_levels:
        if eq["last_confirmed"] <= i:
            add("equal_highs" if eq["kind"] == "equal_highs" else "equal_lows", eq["label"], eq["price"],
                0.76, "Clustered swings at one price. Stops tend to rest here.", "structure",
                tags=["liquidity"])

    # ---- round numbers -----------------------------------------------------
    for r in round_number_levels(price, tick):
        add(r["kind"], r["label"], r["price"], r["strength"], r["detail"], r["group"])

    # ---- supply / demand zones (most recent 12 still-active blocks) --------
    active_zones = [z for z in prep.zones
                    if z.available_index <= i and (z.mitigated_index is None or i < z.mitigated_index)][-12:]
    for z in active_zones:
        add("zone", z.label, (z.low + z.high) / 2, z.strength, z.detail, "zone",
            tags=[z.kind, "order_block"],
            extra={"zone_low": z.low, "zone_high": z.high, "zone_kind": z.kind})

    out.sort(key=lambda r: -r["strength"])
    return out


def nearest(levels: list[dict], price: float, side: str | None = None) -> dict | None:
    pool = [lv for lv in levels if side is None or lv["side"] == side]
    if not pool:
        return None
    return min(pool, key=lambda lv: abs(lv["price"] - price))


def at_level(levels: list[dict], price: float, tolerance: float, min_strength: float = 0.0) -> dict | None:
    """Strongest level within `tolerance` price units of `price`."""
    hits = [lv for lv in levels
            if abs(lv["price"] - price) <= tolerance and lv["strength"] >= min_strength]
    if not hits:
        return None
    return max(hits, key=lambda lv: lv["strength"] - abs(lv["price"] - price) / max(tolerance, 1e-9) * 0.2)


def session_levels(levels: list[dict]) -> list[dict]:
    return [lv for lv in levels if lv["group"] == "session"]


def confluence_count(levels: list[dict], price: float, tolerance: float) -> list[dict]:
    """Levels clustered at the same price - the basis of the location score."""
    return [lv for lv in levels if abs(lv["price"] - price) <= tolerance]
