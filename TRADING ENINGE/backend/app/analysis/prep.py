"""PreparedFrame: all indicator/structure/level work computed once per series.

The prepared object is the look-ahead firewall. Indicators are causal by
construction; swing points carry a `confirmed_index`; structure events, sweeps,
zones and naked POCs carry the index at which they became knowable. Any
consumer that respects `index` cannot see the future.
"""
from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import datetime

import numpy as np

from ..data.frame import CandleFrame
from ..instruments import Instrument
from ..session import ET, epoch, rth_times, trading_date
from . import indicators as ind
from . import levels as lv
from . import patterns as pat
from . import regime as rg
from . import structure as st
from . import sweeps as sw
from . import volume_profile as vp
from . import vwap as vw


@dataclass
class PeriodStats:
    high: float
    low: float
    open: float
    close: float
    volume: float
    start_td: int
    end_td: int


def _period_groups(keys: list, day_high, day_low, day_open, day_close, day_vol) -> list[PeriodStats]:
    """Aggregate trading days into weeks/months."""
    groups: list[PeriodStats] = []
    group_keys: list = []
    for k, key in enumerate(keys):
        if groups and group_keys[-1] == key:
            g = groups[-1]
            g.high = max(g.high, float(day_high[k]))
            g.low = min(g.low, float(day_low[k]))
            g.close = float(day_close[k])
            g.volume += float(day_vol[k])
            g.end_td = k + 1
        else:
            groups.append(PeriodStats(
                float(day_high[k]), float(day_low[k]), float(day_open[k]),
                float(day_close[k]), float(day_vol[k]), k, k + 1,
            ))
            group_keys.append(key)
    return groups


@dataclass
class PreparedFrame:
    frame: CandleFrame
    inst: Instrument
    timeframe: str
    n: int
    td_dates: list
    td_index: np.ndarray
    td_start_idx: np.ndarray
    td_end_idx: np.ndarray
    is_rth: np.ndarray
    rth_start_idx: dict
    orb_end_idx: dict
    orb_minutes: int
    swing_lookback: int
    atr: np.ndarray
    ema9: np.ndarray
    ema21: np.ndarray
    ema50: np.ndarray
    ema200: np.ndarray
    rsi: np.ndarray
    macd_line: np.ndarray
    macd_signal: np.ndarray
    macd_hist: np.ndarray
    rel_volume: np.ndarray
    vwap_data: dict
    regime: dict
    swings: list
    structure: list
    equal_levels: list
    patterns: dict
    sweeps: dict
    zones: list
    profiles: dict
    prior_profiles: dict
    prior: dict
    naked: list
    on_high_run: np.ndarray
    on_low_run: np.ndarray
    or_high_run: np.ndarray
    or_low_run: np.ndarray
    rth_open_price: np.ndarray
    day_high: np.ndarray
    day_low: np.ndarray
    bb_mid: np.ndarray
    bb_upper: np.ndarray
    bb_lower: np.ndarray
    bb_width_rank: np.ndarray
    dc_upper: np.ndarray
    dc_lower: np.ndarray
    delta_proxy: np.ndarray
    half_life: np.ndarray
    variance_ratio: np.ndarray
    stoch_rsi: np.ndarray
    supertrend: np.ndarray
    supertrend_dir: np.ndarray
    quantum_shift: np.ndarray
    quantum_shift_score: np.ndarray
    day_high_run: np.ndarray
    day_low_run: np.ndarray
    adr: np.ndarray
    adr_used: np.ndarray
    swing_confirm_times: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=np.int64))
    event_times: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=np.int64))
    _composite_cache: dict = field(default_factory=dict)

    # ------------------------------------------------------------- profiles
    def current_profile(self, i: int):
        k = int(self.td_index[i])
        start = int(self.td_start_idx[k])
        if i <= start:
            return None
        return vp.build_profile(
            self.frame.high[start:i + 1], self.frame.low[start:i + 1], self.frame.close[start:i + 1],
            self.frame.volume[start:i + 1], self.inst.tick_size, label="session",
            bin_ticks=4, start_ts=float(self.frame.ts[start]), end_ts=float(self.frame.ts[i]),
        )

    def composite_profile_for(self, td: int, sessions: int = 5):
        hit = self._composite_cache.get(td)
        if hit is not None:
            return hit
        first = max(0, td - sessions)
        if td <= 0:
            self._composite_cache[td] = None
            return None
        start = int(self.td_start_idx[first])
        end = int(self.td_end_idx[td - 1])
        if end <= start:
            self._composite_cache[td] = None
            return None
        prof = vp.build_profile(
            self.frame.high[start:end], self.frame.low[start:end], self.frame.close[start:end],
            self.frame.volume[start:end], self.inst.tick_size, label=f"{sessions}-session composite",
            bin_ticks=8, start_ts=float(self.frame.ts[start]), end_ts=float(self.frame.ts[end - 1]),
        )
        self._composite_cache[td] = prof
        return prof

    def naked_pocs(self, td: int) -> list[float]:
        return [p["price"] for p in self.naked
                if p["available_index"] <= int(self.td_start_idx[td]) < (p["touch_index"] or 10 ** 12)]

    # --------------------------------------------------------------- helpers
    def last_rth_bars(self, i: int, count: int) -> range:
        return range(max(0, i - count + 1), i + 1)

    def bars_since(self, i: int, price: float, direction: str) -> int | None:
        """Bars since price last traded at/through `price` (0 = this bar)."""
        if direction == "above":
            hits = np.flatnonzero(self.frame.high[:i + 1] >= price)
        else:
            hits = np.flatnonzero(self.frame.low[:i + 1] <= price)
        if len(hits) == 0:
            return None
        return int(i - hits[-1])


_CACHE: OrderedDict[tuple, PreparedFrame] = OrderedDict()
_CACHE_MAX = 6


def clear_cache() -> None:
    _CACHE.clear()


def get_prepared(frame: CandleFrame, inst: Instrument, orb_minutes: int = 30,
                 swing_lookback: int = 250) -> PreparedFrame:
    key = (frame.symbol, frame.timeframe, frame.provider,
           int(frame.ts[-1]) if len(frame) else 0, len(frame))
    hit = _CACHE.get(key)
    if hit is not None:
        _CACHE.move_to_end(key)
        return hit
    prepared = prepare(frame, inst, orb_minutes, swing_lookback)
    _CACHE[key] = prepared
    while len(_CACHE) > _CACHE_MAX:
        _CACHE.popitem(last=False)
    return prepared


def prepare(frame: CandleFrame, inst: Instrument, orb_minutes: int = 30,
            swing_lookback: int = 250) -> PreparedFrame:
    n = len(frame)
    if n < 5:
        raise ValueError("need at least 5 bars to analyse")
    ts = frame.ts
    high, low, close, open_ = frame.high, frame.low, frame.close, frame.open
    volume = frame.volume
    tick = inst.tick_size

    # --------------------------------------------------------- sessions ----
    td_dates = []
    td_index = np.zeros(n, dtype=np.int64)
    td_start = []
    current = None
    for i in range(n):
        d = trading_date(int(ts[i]))
        if d != current:
            current = d
            td_dates.append(d)
            td_start.append(i)
        td_index[i] = len(td_dates) - 1
    td_start_idx = np.array(td_start, dtype=np.int64)
    td_end_idx = np.append(td_start_idx[1:], n)
    n_td = len(td_dates)

    rth_open = np.zeros(n_td)
    rth_close = np.zeros(n_td)
    for k, d in enumerate(td_dates):
        o_t, c_t = rth_times(inst.sector, d)
        rth_open[k] = epoch(datetime.combine(d, o_t, tzinfo=ET))
        rth_close[k] = epoch(datetime.combine(d, c_t, tzinfo=ET))
    is_rth = (ts >= rth_open[td_index]) & (ts < rth_close[td_index])

    rth_start_idx: dict[int, int | None] = {}
    orb_end_idx: dict[int, int | None] = {}
    for k in range(n_td):
        s, e = int(td_start_idx[k]), int(td_end_idx[k])
        flags = is_rth[s:e]
        if not flags.any():
            rth_start_idx[k] = None
            orb_end_idx[k] = None
            continue
        ri = s + int(np.flatnonzero(flags)[0])
        rth_start_idx[k] = ri
        after = np.flatnonzero(ts[ri:e] >= rth_open[k] + orb_minutes * 60)
        orb_end_idx[k] = ri + int(after[0]) if len(after) else e

    # ------------------------------------------------------- indicators ----
    atr = ind.atr(high, low, close, 14)
    ema9 = ind.ema(close, 9)
    ema21 = ind.ema(close, 21)
    ema50 = ind.ema(close, 50)
    ema200 = ind.ema(close, 200)
    rsi = ind.rsi(close, 14)
    macd_line, macd_signal, macd_hist = ind.macd(close)
    relvol = ind.relative_volume(volume, 20)
    bb_mid, bb_upper, bb_lower, bb_width = ind.bollinger(close, 20, 2.0)
    bb_width_rank = ind.percentile_rank(bb_width, 100)
    dc_upper, dc_lower = ind.donchian(high, low, 20, shift=1)
    delta_proxy = ind.volume_delta(high, low, close, volume)
    half_life = ind.half_life(close, 60)
    stoch = ind.stoch_rsi(close, 14, 3)
    st_line, st_dir = ind.supertrend(high, low, close, 10, 3.0)
    qshift, qshift_score = ind.quantum_shift(high, low, close, relvol, ema9, ema21)
    vwap_data = vw.vwap_series(high, low, close, volume, td_index)
    regime = rg.classify(high, low, close, volume)

    # --------------------------------------------------------- structure ---
    swings = st.find_swings(high, low, atr, 3, 3)
    events = st.build_structure(swings, close)
    equal = st.equal_levels(swings, tick)

    # ---------------------------------------------------------- patterns ---
    patterns = pat.detect_patterns(open_, high, low, close, volume, relvol, atr)

    # ------------------------------------------------------- prior stats ---
    day_high = np.maximum.reduceat(high, td_start_idx)
    day_low = np.minimum.reduceat(low, td_start_idx)
    day_vol = np.add.reduceat(volume, td_start_idx)
    day_open = open_[td_start_idx]
    day_close = close[td_end_idx - 1]
    day_stats = [PeriodStats(float(day_high[k]), float(day_low[k]), float(day_open[k]),
                             float(day_close[k]), float(day_vol[k]), k, k + 1) for k in range(n_td)]

    # ---- running session extremes, average daily range ---------------------
    day_high_run = np.full(n, np.nan)
    day_low_run = np.full(n, np.nan)
    for k in range(n_td):
        s, e = int(td_start_idx[k]), int(td_end_idx[k])
        if e > s:
            day_high_run[s:e] = np.maximum.accumulate(high[s:e])
            day_low_run[s:e] = np.minimum.accumulate(low[s:e])
    # ADR and the fraction of it already used are futures day-trading context:
    # they answer "how much of a normal day has this session already travelled?"
    day_ranges = np.array([float(day_high[k] - day_low[k]) for k in range(n_td)])
    adr = np.full(n, np.nan)
    adr_used = np.full(n, np.nan)
    adr_window = 14
    for k in range(n_td):
        history = day_ranges[max(0, k - adr_window):k]
        if len(history) == 0:
            continue
        s, e = int(td_start_idx[k]), int(td_end_idx[k])
        reference = float(np.mean(history))
        adr[s:e] = reference
        if reference > 0:
            adr_used[s:e] = (day_high_run[s:e] - day_low_run[s:e]) / reference

    week_keys = [(d.isocalendar()[0], d.isocalendar()[1]) for d in td_dates]
    month_keys = [(d.year, d.month) for d in td_dates]
    weeks = _period_groups(week_keys, day_high, day_low, day_open, day_close, day_vol)
    months = _period_groups(month_keys, day_high, day_low, day_open, day_close, day_vol)
    week_of_td = {}
    month_of_td = {}
    for gi, g in enumerate(weeks):
        for k in range(g.start_td, g.end_td):
            week_of_td[k] = gi
    for gi, g in enumerate(months):
        for k in range(g.start_td, g.end_td):
            month_of_td[k] = gi

    # ------------------------------------------------------ session profiles
    profiles: dict[int, vp.Profile] = {}
    for k in range(n_td):
        s, e = int(td_start_idx[k]), int(td_end_idx[k])
        prof = vp.build_profile(high[s:e], low[s:e], close[s:e], volume[s:e], tick,
                                label=str(td_dates[k]), bin_ticks=4,
                                start_ts=float(ts[s]), end_ts=float(ts[e - 1]))
        if prof is not None:
            profiles[k] = prof
    prior_profiles = {k: profiles.get(k - 1) for k in range(n_td) if k > 0}

    prior: dict[int, dict] = {}
    for k in range(n_td):
        d: dict = {}
        if k > 0:
            p = day_stats[k - 1]
            d.update({"pdh": p.high, "pdl": p.low, "pdc": p.close, "pdo": p.open,
                      "pd_date": td_dates[k - 1].isoformat()})
        gi = week_of_td.get(k)
        if gi is not None and gi > 0:
            w = weeks[gi - 1]
            d.update({"pwh": w.high, "pwl": w.low, "pwc": w.close, "pwo": w.open})
        mi = month_of_td.get(k)
        if mi is not None and mi > 0:
            m = months[mi - 1]
            d.update({"pmh": m.high, "pml": m.low, "pmc": m.close, "pmo": m.open})
        prior[k] = d

    # --------------------------------------------------- overnight / OR ----
    on_high_run = np.full(n, np.nan)
    on_low_run = np.full(n, np.nan)
    or_high_run = np.full(n, np.nan)
    or_low_run = np.full(n, np.nan)
    rth_open_price = np.full(n, np.nan)
    for k in range(n_td):
        s, e = int(td_start_idx[k]), int(td_end_idx[k])
        ri = rth_start_idx[k]
        if ri is None:
            # session has not reached its RTH open yet: the overnight extreme is
            # still developing, so only running values are knowable
            if e > s:
                on_high_run[s:e] = np.maximum.accumulate(high[s:e])
                on_low_run[s:e] = np.minimum.accumulate(low[s:e])
            continue
        rth_open_price[ri:e] = float(open_[ri])
        if ri > s:
            seg_h, seg_l = high[s:ri], low[s:ri]
            on_high_run[s:ri] = np.maximum.accumulate(seg_h)
            on_low_run[s:ri] = np.minimum.accumulate(seg_l)
            on_high_run[ri:e] = float(seg_h.max())
            on_low_run[ri:e] = float(seg_l.min())
        oe = int(orb_end_idx[k] or e)
        if oe > ri:
            oh, ol = high[ri:oe], low[ri:oe]
            or_high_run[ri:oe] = np.maximum.accumulate(oh)
            or_low_run[ri:oe] = np.minimum.accumulate(ol)
            or_high_run[oe:e] = float(oh.max())
            or_low_run[oe:e] = float(ol.min())

    # ------------------------------------------------------------- zones ---
    zones = lv.order_blocks(open_, high, low, close, events)

    # ------------------------------------------------------- naked POCs ----
    naked = []
    for k, prof in profiles.items():
        start = int(td_end_idx[k])
        if start >= n:
            continue
        touch = None
        hit = np.flatnonzero((low[start:] <= prof.poc) & (high[start:] >= prof.poc))
        if len(hit):
            touch = int(start + hit[0])
        naked.append({"price": prof.poc, "available_index": start, "touch_index": touch,
                      "session": str(td_dates[k])})

    # ------------------------------------------------------------ sweeps ---
    base_levels: dict[int, list] = {}
    for k in range(n_td):
        refs = []
        p = prior.get(k, {})
        for key, label in (("pdh", "prior day high"), ("pdl", "prior day low"), ("pdc", "prior day close")):
            if key in p:
                refs.append(sw.LevelRef(p[key], key, label, int(td_start_idx[k]), 0.95))
        if k in prior_profiles and prior_profiles[k] is not None:
            pp = prior_profiles[k]
            refs.append(sw.LevelRef(pp.poc, "poc", "prior day POC", int(td_start_idx[k]), 0.85))
            refs.append(sw.LevelRef(pp.vah, "vah", "prior day VAH", int(td_start_idx[k]), 0.75))
            refs.append(sw.LevelRef(pp.val, "val", "prior day VAL", int(td_start_idx[k]), 0.75))
        for nm in naked:
            if nm["available_index"] <= int(td_start_idx[k]) < (nm["touch_index"] or 10 ** 12):
                refs.append(sw.LevelRef(nm["price"], "naked_poc", "naked POC", int(td_start_idx[k]), 0.7))
        base_levels[k] = refs
    swing_refs = [sw.LevelRef(s.price, "swing", f"swing {s.kind}", s.confirmed_index, float(s.strength))
                  for s in swings]
    for k in range(n_td):
        ri = rth_start_idx[k]
        if ri is not None and np.isfinite(on_high_run[ri]):
            swing_refs.append(sw.LevelRef(float(on_high_run[ri]), "onh", "overnight high", ri, 0.7))
            swing_refs.append(sw.LevelRef(float(on_low_run[ri]), "onl", "overnight low", ri, 0.7))
        oe = orb_end_idx[k]
        if oe is not None and oe < n and np.isfinite(or_high_run[oe]):
            swing_refs.append(sw.LevelRef(float(or_high_run[oe]), "orh", "opening range high", int(oe), 0.65))
            swing_refs.append(sw.LevelRef(float(or_low_run[oe]), "orl", "opening range low", int(oe), 0.65))
    for eq in equal:
        swing_refs.append(sw.LevelRef(eq["price"], eq["kind"], eq["label"], int(eq["last_confirmed"]), 0.8))
    sweeps = sw.detect_sweeps(high, low, close, open_, tick, atr, relvol,
                              base_levels, swing_refs, td_index)

    swing_confirm_times = np.array([s.confirmed_index for s in swings], dtype=np.int64)
    event_times = np.array([e.index for e in events], dtype=np.int64)
    return PreparedFrame(
        frame=frame, inst=inst, timeframe=frame.timeframe, n=n, td_dates=td_dates,
        td_index=td_index, td_start_idx=td_start_idx, td_end_idx=td_end_idx, is_rth=is_rth,
        rth_start_idx=rth_start_idx, orb_end_idx=orb_end_idx, orb_minutes=orb_minutes,
        swing_lookback=swing_lookback, atr=atr, ema9=ema9, ema21=ema21, ema50=ema50,
        ema200=ema200, rsi=rsi, macd_line=macd_line, macd_signal=macd_signal,
        macd_hist=macd_hist, rel_volume=relvol, vwap_data=vwap_data, regime=regime,
        swings=swings, structure=events, equal_levels=equal, patterns=patterns,
        sweeps=sweeps, zones=zones, profiles=profiles, prior_profiles=prior_profiles,
        prior=prior, naked=naked, on_high_run=on_high_run, on_low_run=on_low_run,
        or_high_run=or_high_run, or_low_run=or_low_run, rth_open_price=rth_open_price,
        day_high=day_high, day_low=day_low,
        bb_mid=bb_mid, bb_upper=bb_upper, bb_lower=bb_lower, bb_width_rank=bb_width_rank,
        dc_upper=dc_upper, dc_lower=dc_lower, delta_proxy=delta_proxy,
        half_life=half_life, variance_ratio=regime["vr"],
        stoch_rsi=stoch, supertrend=st_line, supertrend_dir=st_dir,
        quantum_shift=qshift, quantum_shift_score=qshift_score,
        day_high_run=day_high_run, day_low_run=day_low_run, adr=adr, adr_used=adr_used,
        swing_confirm_times=swing_confirm_times, event_times=event_times,
    )
