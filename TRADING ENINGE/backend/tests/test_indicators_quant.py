"""Tests for the futures indicator pack: SuperTrend, Stochastic RSI, the
quantum-shift detector, average daily range and floor pivots.

These are the numbers the chart draws and the card quotes, so each test pins a
property that would otherwise fail silently.
"""
from __future__ import annotations

import numpy as np
import pytest

from app.analysis import indicators as ind
from app.analysis import levels as lv
from app.analysis.context import build_context
from app.analysis.prep import prepare


def _ramp(n: int = 80, start: float = 100.0, step: float = 1.0) -> np.ndarray:
    return start + np.arange(n, dtype=float) * step


# ------------------------------------------------------------------ supertrend
def test_supertrend_trails_below_price_in_an_uptrend():
    close = _ramp(120)
    high = close + 1.0
    low = close - 1.0
    line, direction = ind.supertrend(high, low, close, 10, 3.0)
    i = 100
    assert direction[i] == 1.0
    assert line[i] < close[i], "an up-trend stop must sit under price"


def test_supertrend_flips_on_a_break_down():
    close = np.concatenate([_ramp(100), _ramp(60, start=199.0, step=-4.0)])
    high = close + 1.0
    low = close - 1.0
    line, direction = ind.supertrend(high, low, close, 10, 3.0)
    assert direction[60] == 1.0
    assert direction[-1] == -1.0, "a sustained break down must flip the line"
    assert line[-1] > close[-1], "a down-trend stop must sit above price"


def test_supertrend_is_causal():
    close = _ramp(140)
    high = close + 1.0
    low = close - 1.0
    full, _ = ind.supertrend(high, low, close, 10, 3.0)
    for i in (60, 91, 139):
        part, _ = ind.supertrend(high[: i + 1], low[: i + 1], close[: i + 1], 10, 3.0)
        assert part[i] == pytest.approx(full[i])


# --------------------------------------------------------------- stochastic rsi
def test_stoch_rsi_stays_in_range_and_hits_both_ends():
    # a pure ramp pins RSI at 100, which leaves the oscillator with no range to
    # normalise against, so the series needs real variation in it
    ripple = 3.0 * np.sin(np.arange(120) / 2.4)
    close = np.concatenate([_ramp(60), _ramp(60, start=159.0, step=-1.0)]) + ripple
    stoch = ind.stoch_rsi(close, 14, 3)
    valid = stoch[np.isfinite(stoch)]
    assert len(valid) > 0
    assert valid.min() >= -1e-9 and valid.max() <= 100 + 1e-9
    # the relentless up leg pushes the oscillator to its ceiling
    assert np.nanmax(stoch[30:55]) > 90.0
    assert np.nanmin(stoch[-30:]) < 10.0


# ---------------------------------------------------------------- quantum shift
def test_quantum_shift_fires_on_a_volume_reclaim():
    n = 60
    close = _ramp(n, step=-0.5)          # downtrend: fast EMA below slow EMA
    high = close + 0.4
    low = close - 0.4
    rel_volume = np.ones(n)
    ema_fast = ind.ema(close, 9)
    ema_slow = ind.ema(close, 21)
    # a bar that trades under the fast EMA and closes strong on heavy volume.
    # The move has to clear the EMA that lags the downtrend, not just the last close.
    i = n - 5
    low[i] = close[i] - 3.5
    close[i] = close[i] + 3.0
    high[i] = close[i] + 0.3
    rel_volume[i] = 2.0
    shift, score = ind.quantum_shift(high, low, close, rel_volume, ema_fast, ema_slow)
    assert shift[i] == 1.0, "a volume reclaim above the fast EMA must register as an up shift"
    assert 0.0 < score[i] <= 1.0


def test_quantum_shift_ignores_quiet_bars():
    n = 60
    close = _ramp(n, step=-0.5)
    high = close + 0.4
    low = close - 0.4
    rel_volume = np.ones(n)
    i = n - 5
    low[i] = close[i] - 3.5
    close[i] = close[i] + 3.0
    high[i] = close[i] + 0.3
    rel_volume[i] = 0.9                   # below the confirmation threshold
    ema_fast = ind.ema(close, 9)
    ema_slow = ind.ema(close, 21)
    shift, _ = ind.quantum_shift(high, low, close, rel_volume, ema_fast, ema_slow)
    assert shift[i] == 0.0


# ------------------------------------------------------------------ ADR / pivots
def test_adr_uses_completed_sessions_only(mnq_frame, mnq_inst):
    prep = prepare(mnq_frame, mnq_inst)
    td = int(prep.td_index[-1])
    day_ranges = np.array([float(prep.day_high[k] - prep.day_low[k])
                           for k in range(len(prep.td_dates))])
    history = day_ranges[max(0, td - 14):td]
    expected = float(np.mean(history))
    assert prep.adr[-1] == pytest.approx(expected, rel=1e-6)
    used = prep.adr_used[-1]
    if np.isfinite(used):
        assert used > 0
    # the first session has no history, so it must not carry a fabricated ADR
    assert not np.isfinite(prep.adr[0])


def test_floor_pivots_come_from_the_prior_session(mnq_frame, mnq_inst):
    prep = prepare(mnq_frame, mnq_inst)
    i = len(mnq_frame) - 1
    prior = prep.prior[int(prep.td_index[i])]
    rows = {row["kind"]: row for row in lv.assemble(prep, i)}
    assert "pivot_pp" in rows, "floor pivots should be assembled as levels"
    pp = (prior["pdh"] + prior["pdl"] + prior["pdc"]) / 3.0
    assert rows["pivot_pp"]["price"] == pytest.approx(mnq_inst.round_tick(pp), abs=1e-6)
    assert rows["pivot_r1"]["price"] == pytest.approx(
        mnq_inst.round_tick(2 * pp - prior["pdl"]), abs=1e-6)
    assert rows["pivot_s1"]["price"] == pytest.approx(
        mnq_inst.round_tick(2 * pp - prior["pdh"]), abs=1e-6)
    assert rows["pivot_pp"]["group"] == "pivot"


def test_context_exposes_the_new_indicators(mnq_frame, mnq_inst):
    prep = prepare(mnq_frame, mnq_inst)
    ctx = build_context(prep, len(mnq_frame) - 2, light=True)
    for key in ("stoch_rsi", "supertrend", "supertrend_dir", "adr", "adr_used_pct"):
        assert key in ctx.indicators, f"{key} missing from the analysis context"
    assert ctx.indicators["supertrend_dir"] in (-1.0, 1.0)
