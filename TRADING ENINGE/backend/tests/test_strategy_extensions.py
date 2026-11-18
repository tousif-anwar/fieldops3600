"""Tests for the indicators, regime gate and strategies added from the
vendored trading skills (Bollinger/Donchian squeeze, AR(1) half-life, variance
ratio, candle-implied delta).

Each test pins a specific rule rather than a snapshot, so a silent change to a
threshold or a gate fails loudly.
"""
from __future__ import annotations

import numpy as np
import pytest

from app.analysis import indicators as ind
from app.analysis.context import build_context
from app.analysis.prep import prepare
from app.signals import scoring
from app.strategies.squeeze_expansion import SqueezeExpansion
from app.strategies.vwap_mean_reversion import VwapMeanReversion


# --------------------------------------------------------------- indicators
def test_bollinger_bands_are_ordered_and_causal():
    close = np.cumsum(np.ones(80)) + 100.0
    mid, upper, lower, width = ind.bollinger(close, 20, 2.0)
    i = 60
    assert lower[i] < mid[i] < upper[i]
    assert width[i] == pytest.approx((upper[i] - lower[i]) / mid[i])
    # recomputing from the truncated history must give the same number
    mid_t, upper_t, lower_t, _ = ind.bollinger(close[: i + 1], 20, 2.0)
    assert upper_t[i] == pytest.approx(upper[i])
    assert lower_t[i] == pytest.approx(lower[i])


def test_donchian_channel_excludes_the_current_bar():
    high = np.full(30, 100.0)
    low = np.full(30, 99.0)
    high[29] = 110.0  # the current bar is the highest of the series
    up, dn = ind.donchian(high, low, 20, shift=1)
    assert up[29] == 100.0, "channel must not contain the bar being tested"
    assert dn[29] == 99.0
    # the value at i covers bars i-period .. i-1, so nothing before that window
    assert np.isnan(up[19]) and np.isnan(dn[19])
    assert up[20] == pytest.approx(100.0)
    assert dn[20] == pytest.approx(99.0)


def test_half_life_matches_the_ar1_constant():
    beta = -0.3
    rng = np.random.default_rng(7)
    n = 600
    x = np.zeros(n)
    for i in range(1, n):
        x[i] = (1 + beta) * x[i - 1] + rng.normal(0, 1.0)
    hl = ind.half_life(x, 60)
    expected = -np.log(2) / np.log(1 + beta)
    assert np.isfinite(hl[-1])
    assert hl[-1] == pytest.approx(expected, rel=0.35)


def test_half_life_is_nan_when_the_series_does_not_revert():
    trending = np.cumsum(np.ones(300)) + 1000.0
    hl = ind.half_life(trending, 60)
    assert np.isnan(hl[-1]), "a pure trend has no measurable half-life"


def test_variance_ratio_separates_autocorrelation_regimes():
    rng = np.random.default_rng(11)
    n = 900
    noise = rng.normal(0, 1.0, n)
    trending = np.empty(n)
    reversion = np.empty(n)
    trending[0] = 100.0
    reversion[0] = 100.0
    for i in range(1, n):
        # positive autocorrelation: changes persist
        trending[i] = trending[i - 1] + 0.6 * (trending[i - 1] - trending[i - 2] if i > 1 else 0) + noise[i]
        # negative autocorrelation: changes alternate
        reversion[i] = reversion[i - 1] + noise[i] + (-0.8 * (reversion[i - 1] - reversion[i - 2]) if i > 1 else 0)
    vr_trend = ind.variance_ratio(trending, 200, 5)[-1]
    vr_rev = ind.variance_ratio(reversion, 200, 5)[-1]
    assert vr_trend > 1.1
    assert vr_rev < 0.9


def test_volume_delta_sign_follows_the_close_position():
    high = np.array([10.0, 10.0, 10.0])
    low = np.array([9.0, 9.0, 9.0])
    close = np.array([10.0, 9.0, 9.5])
    volume = np.array([100.0, 100.0, 100.0])
    delta = ind.volume_delta(high, low, close, volume)
    assert delta[0] == pytest.approx(100.0)
    assert delta[1] == pytest.approx(-100.0)
    assert delta[2] == pytest.approx(0.0, abs=1e-9)


# ------------------------------------------------------------------ scoring
def test_regime_weights_stay_normalised_and_shift_emphasis():
    base = scoring.effective_weights({"trend_regime": "transitional"})
    trending = scoring.effective_weights({"trend_regime": "trending"})
    ranging = scoring.effective_weights({"trend_regime": "ranging"})
    assert sum(base.values()) == pytest.approx(sum(scoring.FACTOR_WEIGHTS.values()))
    assert trending["trend"] > base["trend"]
    assert trending["location"] < base["location"]
    assert ranging["location"] > base["location"]
    assert ranging["trend"] < base["trend"]


# ---------------------------------------------------------------- strategies
@pytest.fixture
def ctx(mnq_frame, mnq_inst):
    prep = prepare(mnq_frame, mnq_inst)
    return build_context(prep, len(mnq_frame) - 2, light=True)


def test_vwap_fade_is_skipped_without_a_measured_half_life(ctx):
    ctx.vwap = {"vwap": ctx.price - 25.0, "sd": 10.0, "z": 2.5, "upper1": ctx.price - 15.0,
                "lower1": ctx.price - 35.0, "upper2": ctx.price - 5.0, "lower2": ctx.price - 45.0}
    ctx.indicators["half_life"] = None
    assert VwapMeanReversion().evaluate(ctx) is None

    ctx.indicators["half_life"] = 40.0  # too slow to revert inside a session
    assert VwapMeanReversion().evaluate(ctx) is None

    ctx.regime["variance_ratio"] = 1.4  # trending autocorrelation
    ctx.indicators["half_life"] = 6.0
    assert VwapMeanReversion().evaluate(ctx) is None


def test_vwap_fade_geometry(ctx):
    ctx.vwap = {"vwap": ctx.price - 25.0, "sd": 10.0, "z": 2.5, "upper1": ctx.price - 15.0,
                "lower1": ctx.price - 35.0, "upper2": ctx.price - 5.0, "lower2": ctx.price - 45.0}
    ctx.indicators["half_life"] = 6.0
    ctx.regime["variance_ratio"] = 0.85
    cand = VwapMeanReversion().evaluate(ctx)
    assert cand is not None
    assert cand.direction == "short"          # price is above VWAP
    assert cand.entry % ctx.inst.tick_size == pytest.approx(0.0, abs=1e-9)
    assert cand.stop > cand.entry              # stop beyond the band, above the entry
    assert cand.targets[0] < cand.entry        # first target is the mean, below
    assert cand.targets == sorted(cand.targets, reverse=True)
    assert cand.rr() > 1.0


def test_squeeze_requires_recent_compression_and_a_break(ctx):
    prep = ctx.prep
    i = ctx.index
    # widen the channel so a break is impossible, and make the bands wide
    prep.dc_upper[i] = ctx.price + 50.0
    prep.dc_lower[i] = ctx.price - 50.0
    prep.bb_width_rank[max(0, i - 5):i + 1] = 5.0
    ctx.indicators["rel_volume"] = 2.0
    ctx.indicators["atr_percentile"] = 50.0
    ctx.regime["vol_regime"] = "normal"
    assert SqueezeExpansion().evaluate(ctx) is None, "no break, so no setup"

    # no squeeze in the lookback window
    prep.dc_upper[i] = ctx.price - 1.0
    prep.bb_width_rank[max(0, i - 5):i + 1] = 80.0
    assert SqueezeExpansion().evaluate(ctx) is None, "break without compression is not this edge"

    # squeeze plus break. The stop is anchored to the bar's own low and sized in
    # ATR, so both are pinned: otherwise the result depends on the shape of
    # whichever bar the feed happened to deliver last.
    ctx.indicators["atr"] = 8.0
    ctx.bar["high"] = ctx.price + 0.5
    ctx.bar["low"] = ctx.price - 2.0
    prep.bb_width_rank[max(0, i - 5):i + 1] = 8.0
    cand = SqueezeExpansion().evaluate(ctx)
    assert cand is not None
    assert cand.direction == "long"
    assert cand.entry > ctx.price              # stop entry beyond the break
    assert cand.stop < cand.entry
    assert cand.targets == sorted(cand.targets)
    assert cand.entry_type == "stop"


def test_new_strategies_are_registered(registry):
    meta = registry.meta()
    assert "squeeze_expansion" in meta
    assert "vwap_mean_reversion" in meta
    assert registry.build("squeeze_expansion").family == "momentum"
    assert registry.build("vwap_mean_reversion").family == "contra_trend"
