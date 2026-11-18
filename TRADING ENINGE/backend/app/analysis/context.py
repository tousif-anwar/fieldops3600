"""Per-bar analysis context.

The live signal path and the backtester both call `build_context`, so what the
backtest measures is literally the same code path that produces live cards.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np

from ..session import session_bounds, session_label, session_timing_score
from . import indicators as ind
from . import levels as lv
from . import regime as rg
from . import structure as st
from . import vwap as vw


@dataclass
class Context:
    prep: Any
    index: int
    inst: Any
    timeframe: str
    ts: int
    price: float
    bar: dict
    session: dict
    session_label: str
    timing_score: float
    timing_reason: str
    levels: list[dict]
    profiles: dict
    structure: dict
    patterns: list[dict]
    sweeps: list[dict]
    regime: dict
    vwap: dict
    indicators: dict
    zones: list[dict]
    orderflow: dict
    fundamental: dict
    capabilities: dict
    is_rth: bool

    # ------------------------------------------------------------- accessors
    @property
    def atr(self) -> float:
        return float(self.indicators.get("atr") or 0.0)

    @property
    def tick(self) -> float:
        return float(self.inst.tick_size)

    def level_at(self, price: float, tolerance_ticks: float = 6.0, min_strength: float = 0.0):
        return lv.at_level(self.levels, price, tolerance_ticks * self.tick, min_strength)

    def nearest(self, side: str | None = None):
        return lv.nearest(self.levels, self.price, side)

    def levels_near(self, price: float, tolerance_ticks: float = 8.0) -> list[dict]:
        return lv.confluence_count(self.levels, price, tolerance_ticks * self.tick)

    def levels_with_tag(self, tag: str) -> list[dict]:
        return [x for x in self.levels if tag in x.get("tags", [])]

    def key_level(self, kinds: set[str]) -> list[dict]:
        return [x for x in self.levels if x["kind"] in kinds]

    # ------------------------------------------------------------- structure
    def structure_score(self, direction: str) -> tuple[float, str]:
        score = float(self.structure.get("score", 0.0))
        if direction == "long":
            return (max(0.0, score + 0.15), f"structure {self.structure['state']} (score {score:+.2f})")
        return (max(0.0, -score + 0.15), f"structure {self.structure['state']} (score {score:+.2f})")

    def trend_alignment(self, direction: str) -> tuple[float, str]:
        vw_z = float(self.vwap.get("z") or 0.0)
        ema9 = self.indicators.get("ema9")
        ema21 = self.indicators.get("ema21")
        pts = 0.0
        bits = []
        if direction == "long":
            if vw_z > 0.15:
                pts += 0.45
                bits.append(f"price {vw_z:+.1f}sd above VWAP")
            elif vw_z < -0.6:
                pts -= 0.25
                bits.append(f"price {vw_z:+.1f}sd below VWAP (counter-trend)")
            if ema9 and ema21 and ema9 > ema21:
                pts += 0.35
                bits.append("EMA9 above EMA21")
            if self.regime.get("direction") == "up":
                pts += 0.2
                bits.append("EMA50 above EMA200")
        else:
            if vw_z < -0.15:
                pts += 0.45
                bits.append(f"price {vw_z:+.1f}sd below VWAP")
            elif vw_z > 0.6:
                pts -= 0.25
                bits.append(f"price {vw_z:+.1f}sd above VWAP (counter-trend)")
            if ema9 and ema21 and ema9 < ema21:
                pts += 0.35
                bits.append("EMA9 below EMA21")
            if self.regime.get("direction") == "down":
                pts += 0.2
                bits.append("EMA50 below EMA200")
        return max(0.0, min(1.0, pts)), "; ".join(bits) or "no trend alignment"

    def volume_score(self) -> tuple[float, str]:
        rv = float(self.indicators.get("rel_volume") or 1.0)
        delta = self.orderflow.get("delta") if self.orderflow.get("available") else None
        pts = min(1.0, max(0.0, (rv - 0.7) / 1.1))
        bits = [f"relative volume {rv:.1f}x"]
        if delta is not None:
            bits.append(f"bar delta {delta:+.0f}")
        return pts, ", ".join(bits)

    # ---------------------------------------------------------------- output
    def to_dict(self) -> dict:
        return {
            "symbol": self.inst.symbol,
            "timeframe": self.timeframe,
            "index": self.index,
            "time": self.ts,
            "price": self.price,
            "bar": self.bar,
            "session": self.session,
            "session_label": self.session_label,
            "timing_score": round(self.timing_score, 3),
        "session_range": {
            "average_daily_range": self.indicators.get("adr"),
            "adr_used_pct": self.indicators.get("adr_used_pct"),
        },
            "timing_reason": self.timing_reason,
            "levels": self.levels,
            "profiles": {k: (v.dict() if hasattr(v, "dict") else v)
                         for k, v in self.profiles.items()},
            "structure": self.structure,
            "patterns": self.patterns,
            "sweeps": self.sweeps,
            "regime": self.regime,
            "vwap": self.vwap,
            "indicators": self.indicators,
            "zones": self.zones,
            "orderflow": self.orderflow,
            "fundamental": self.fundamental,
            "capabilities": (self.capabilities.dict()
                             if hasattr(self.capabilities, "dict") else self.capabilities),
            "is_rth": self.is_rth,
        }


def _profile_dict(prof) -> dict | None:
    return None if prof is None else prof.dict()


def build_context(
    prep: Any,
    i: int,
    fundamentals: dict | None = None,
    orderflow: dict | None = None,
    capabilities: dict | None = None,
    light: bool = False,
) -> Context:
    """Build the analysis context for a closed bar.

    `light=True` is used by the backtester: identical numbers, but profile
    histograms are left as objects instead of being serialised for the UI.
    """
    i = max(0, min(i, prep.n - 1))
    frame = prep.frame
    inst = prep.inst
    ts = int(frame.ts[i])
    price = float(frame.close[i])
    sess = session_bounds(ts, inst.sector).dict()
    if prep.timeframe == "1d":
        timing, timing_reason = 0.7, "daily bars: intraday timing does not apply"
    else:
        timing, timing_reason = session_timing_score(ts, inst.sector)

    td = int(prep.td_index[i])
    cur = prep.current_profile(i)
    levels = lv.assemble(prep, i, profile=cur)
    prior_prof = prep.prior_profiles.get(td)
    comp = prep.composite_profile_for(td)
    # Profiles stay as objects internally (strategies read .poc/.vah/.val);
    # only the API boundary serialises them, so light and full contexts are identical.
    profiles = {"session": cur, "prior_session": prior_prof, "composite": comp,
                "value_position": None}
    if cur is not None:
        profiles["value_position"] = "above" if price > cur.vah else "below" if price < cur.val else "inside"

    structure = st.trend_at(prep.swings, prep.structure, i,
                            prep.swing_confirm_times, prep.event_times)

    recent_patterns = []
    for back in range(0, 3):
        j = i - back
        for hit in prep.patterns.get(j, []):
            d = hit.dict()
            d["bars_ago"] = back
            recent_patterns.append(d)
    recent_sweeps = []
    for back in range(0, 3):
        j = i - back
        for hit in prep.sweeps.get(j, []):
            d = hit.dict()
            d["bars_ago"] = back
            recent_sweeps.append(d)

    vw = {
        "vwap": float(prep.vwap_data["vwap"][i]),
        "sd": float(prep.vwap_data["sd"][i]),
        "upper1": float(prep.vwap_data["upper1"][i]),
        "lower1": float(prep.vwap_data["lower1"][i]),
        "upper2": float(prep.vwap_data["upper2"][i]),
        "lower2": float(prep.vwap_data["lower2"][i]),
    }
    vw["z"] = round(vw_z(price, vw["vwap"], vw["sd"]), 2)
    vw = {k: (round(v, 6) if isinstance(v, float) and np.isfinite(v) else None) for k, v in vw.items()}

    indicators = {
        "atr": _f(prep.atr[i]),
        "ema9": _f(prep.ema9[i]),
        "ema21": _f(prep.ema21[i]),
        "ema50": _f(prep.ema50[i]),
        "ema200": _f(prep.ema200[i]),
        "rsi": _f(prep.rsi[i]),
        "macd_line": _f(prep.macd_line[i]),
        "macd_signal": _f(prep.macd_signal[i]),
        "macd_hist": _f(prep.macd_hist[i]),
        "rel_volume": _f(prep.rel_volume[i]),
        "adx": _f(prep.regime["adx"][i]),
        "efficiency_ratio": _f(prep.regime["er"][i]),
        "atr_percentile": _f(prep.regime["atr_rank"][i]),
        "variance_ratio": _f(prep.variance_ratio[i]),
        "half_life": _f(prep.half_life[i]),
        "bb_mid": _f(prep.bb_mid[i]),
        "bb_upper": _f(prep.bb_upper[i]),
        "bb_lower": _f(prep.bb_lower[i]),
        "bb_width_rank": _f(prep.bb_width_rank[i]),
        "dc_upper": _f(prep.dc_upper[i]),
        "dc_lower": _f(prep.dc_lower[i]),
        "delta_proxy": _f(prep.delta_proxy[i]),
        "stoch_rsi": _f(prep.stoch_rsi[i]),
        "supertrend": _f(prep.supertrend[i]),
        "supertrend_dir": _f(prep.supertrend_dir[i]),
        "quantum_shift": _f(prep.quantum_shift[i]),
        "quantum_shift_score": _f(prep.quantum_shift_score[i]),
        "adr": _f(prep.adr[i]),
        "adr_used_pct": (_f(prep.adr_used[i]) * 100.0 if _f(prep.adr_used[i]) is not None else None),
    }

    zones = [z if light else z.dict(price=price, i=i) for z in prep.zones
             if z.available_index <= i and (z.mitigated_index is None or i < z.mitigated_index)]

    return Context(
        prep=prep, index=i, inst=inst, timeframe=prep.timeframe, ts=ts, price=price,
        bar={"open": float(frame.open[i]), "high": float(frame.high[i]),
             "low": float(frame.low[i]), "close": price, "volume": float(frame.volume[i])},
        session=sess, session_label=session_label(ts), timing_score=timing,
        timing_reason=timing_reason, levels=levels, profiles=profiles, structure=structure,
        patterns=recent_patterns, sweeps=recent_sweeps, regime=rg.snapshot(prep.regime, i),
        vwap=vw, indicators=indicators, zones=zones,
        orderflow=orderflow or {
            "available": False, "has_trades": False, "has_depth": False,
            "reason": "Order flow requires tick or depth data; this feed provides candles only.",
            "delta": None, "cumulative_delta": None, "footprint": [], "icebergs": [], "stacked": [],
            "absorption": None,
        },
        fundamental=fundamentals or {
            "bias": "neutral", "score": 0.0, "reasons": ["Fundamental layer not attached."],
            "no_trade": False, "size_multiplier": 1.0, "news_window": False,
            "events": [], "headlines": [], "index_context": {},
        },
        capabilities=capabilities or {},
        is_rth=bool(prep.is_rth[i]),
    )


def vw_z(price: float, vwap: float, sd: float) -> float:
    return vw.vwap_z(price, vwap, sd)


def _f(x) -> float | None:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return round(v, 6) if np.isfinite(v) else None
