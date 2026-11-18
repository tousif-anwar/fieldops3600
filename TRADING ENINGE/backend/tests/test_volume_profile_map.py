"""Volume profile invariants behind the profile + bubble map rendering.

The renderer trusts these numbers: bins are drawn at `buckets_low` with height
`step`, and the bubble map splits each bar's volume the same way. If a profile
dropped or duplicated volume, the drawing would be a lie that still looked
plausible.
"""
from __future__ import annotations

import numpy as np
import pytest

from app.analysis import volume_profile as vp
from app.analysis.prep import prepare


def test_session_profiles_match_their_session_volume(mnq_frame, mnq_inst):
    prep = prepare(mnq_frame, mnq_inst)
    assert prep.profiles, "expected at least one session profile"
    for td, prof in prep.profiles.items():
        start, end = int(prep.td_start_idx[td]), int(prep.td_end_idx[td])
        session_volume = float(prep.frame.volume[start:end].sum())
        assert prof.total_volume == pytest.approx(session_volume, rel=1e-6)
        assert sum(prof.bins) == pytest.approx(session_volume, rel=1e-6)
        # geometry the renderer depends on
        assert prof.val <= prof.poc <= prof.vah
        assert prof.low <= prof.poc <= prof.high
        assert prof.step > 0
        assert len(prof.bins) == len(prof.buckets_low)
        # a session profile may not contain bars from after its own session
        assert prof.end_ts <= float(prep.frame.ts[end - 1])
        assert prof.start_ts >= float(prep.frame.ts[start])


def test_profile_conserves_volume_on_a_very_wide_range():
    n = 60
    high = np.linspace(100.0, 900.0, n) + 5.0
    low = high - 10.0
    close = (high + low) / 2.0
    volume = np.full(n, 100.0)
    prof = vp.build_profile(high, low, close, volume, tick=0.25, bin_ticks=4)
    assert prof is not None
    assert sum(prof.bins) == pytest.approx(float(volume.sum()), rel=1e-9)
    assert prof.val <= prof.poc <= prof.vah


def test_profile_puts_the_poc_where_the_volume_is():
    n = 40
    high = np.full(n, 101.0)
    low = np.full(n, 99.0)
    close = np.full(n, 100.0)
    volume = np.full(n, 10.0)
    # concentrate volume in a tight band around 99.5
    high[:30] = 99.6
    low[:30] = 99.4
    close[:30] = 99.5
    volume[:30] = 80.0
    prof = vp.build_profile(high, low, close, volume, tick=0.25, bin_ticks=1)
    assert prof is not None
    assert abs(prof.poc - 99.5) < 0.75
    assert prof.val <= prof.poc <= prof.vah


def test_profile_bucket_spacing_matches_the_rendered_step(mnq_frame, mnq_inst):
    """The canvas draws each bin from buckets_low[k] to buckets_low[k] + step,
    so that spacing has to be uniform and the last bin has to stay inside the
    profile's own price range."""
    prep = prepare(mnq_frame, mnq_inst)
    prof = prep.profiles[sorted(prep.profiles)[-1]]
    gaps = np.diff(np.array(prof.buckets_low))
    assert len(gaps) == len(prof.buckets_low) - 1
    assert np.allclose(gaps, prof.step, rtol=1e-6, atol=1e-9)
    assert prof.buckets_low[0] >= prof.low
    assert prof.buckets_low[-1] + prof.step <= prof.high + prof.step * 1.01 + 1e-9
