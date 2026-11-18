"""Targeted analysis tests built from hand-made series."""
from __future__ import annotations

from datetime import date, datetime

import numpy as np
import pytest

from app.analysis import indicators as ind
from app.analysis import patterns as pat
from app.analysis import structure as st
from app.analysis import volume_profile as vp
from app.analysis import vwap as vw
from app.session import ET, trading_date


def test_trading_date_rolls_at_1800_et():
    monday_evening = datetime(2026, 11, 16, 20, 0, tzinfo=ET)
    monday_morning = datetime(2026, 11, 16, 9, 30, tzinfo=ET)
    assert trading_date(monday_evening) == date(2026, 11, 17)
    assert trading_date(monday_morning) == date(2026, 11, 16)


def test_volume_profile_poc_tracks_volume_cluster():
    n = 30
    high = np.full(n, 101.0)
    low = np.full(n, 99.0)
    close = np.full(n, 100.0)
    volume = np.ones(n)
    # push most volume into a tight band at 99.5
    high[:20] = 99.6
    low[:20] = 99.4
    close[:20] = 99.5
    volume[:20] = 50.0
    prof = vp.build_profile(high, low, close, volume, tick=0.25, bin_ticks=1)
    assert prof is not None
    assert abs(prof.poc - 99.5) < 0.6
    assert prof.val <= prof.poc <= prof.vah
    assert prof.total_volume > 0
    assert vp.value_position(99.5, prof) in {"inside_value", "in_value"}


def test_engulfing_pattern_detected():
    open_ = np.array([100.0, 99.0, 98.4])
    high = np.array([101.0, 100.0, 102.0])
    low = np.array([99.5, 98.0, 98.2])
    close = np.array([99.5, 98.5, 101.5])
    volume = np.array([100.0, 150.0, 300.0])
    relvol = np.array([1.0, 1.5, 2.5])
    atr = np.array([1.0, 1.0, 1.0])
    hits = pat.detect_patterns(open_, high, low, close, volume, relvol, atr)
    names = [h.name for h in hits.get(2, [])]
    assert "Bullish engulfing" in names


def test_swing_confirmation_lag():
    high = np.array([1, 2, 3, 5, 3, 2, 1, 2, 3], dtype=float)
    low = high - 0.5
    close = high - 0.2
    atr = np.ones(len(high))
    swings = st.find_swings(high, low, atr, left=2, right=2)
    highs = [s for s in swings if s.kind == "high"]
    assert highs, swings
    top = max(highs, key=lambda s: s.price)
    assert top.index == 3
    assert top.confirmed_index == 5  # available two bars later, never before


def test_bos_after_close_through_swing():
    close = np.array([10, 10.2, 10.4, 10.1, 9.9, 10.0, 10.6], dtype=float)
    swings = [st.Swing(index=2, price=10.4, kind="high", confirmed_index=4, strength=0.5),
              st.Swing(index=4, price=9.9, kind="low", confirmed_index=6, strength=0.5)]
    events = st.build_structure(swings, close)
    kinds = [(e.index, e.kind, e.direction) for e in events]
    assert (6, "BOS", "bull") in kinds


def test_vwap_bands_are_ordered():
    n = 50
    high = np.linspace(100, 105, n)
    low = high - 1
    close = high - 0.4
    volume = np.full(n, 10.0)
    sessions = np.zeros(n, dtype=int)
    out = vw.vwap_series(high, low, close, volume, sessions)
    i = n - 1
    assert out["lower2"][i] < out["lower1"][i] < out["vwap"][i] < out["upper1"][i] < out["upper2"][i]


def test_indicators_have_no_future_leak():
    close = np.cumsum(np.ones(60)) + 100
    e = ind.ema(close, 10)
    # value at i must be reproducible from close[:i+1] alone
    for i in (20, 35, 59):
        assert pytest.approx(e[i]) == ind.ema(close[:i + 1], 10)[i]


def test_atr_positive_and_scaled():
    high = np.array([10, 11, 12, 11.5, 12.5, 13])
    low = np.array([9, 10, 11, 10.5, 11.5, 12])
    close = np.array([9.5, 10.5, 11.5, 11, 12, 12.5])
    a = ind.atr(high, low, close, 3)
    assert np.isfinite(a[-1]) and a[-1] > 0
