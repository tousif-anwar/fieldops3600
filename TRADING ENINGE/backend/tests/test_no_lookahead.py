"""Look-ahead tests.

The strongest available proof for an event-driven backtest: build the analysis
for bar `i` twice - once from the full history and once from history truncated
at `i` - and require identical output. If any component peeked forward, the two
would differ.
"""
from __future__ import annotations

import pytest

from app.analysis.context import build_context
from app.analysis.prep import prepare
from app.signals.engine import evaluate


def _levels_signature(ctx):
    return sorted((lv["kind"], round(lv["price"], 4), round(lv["strength"], 4)) for lv in ctx.levels)


def _profile_sig(prof):
    if prof is None:
        return None
    if isinstance(prof, dict):
        return tuple(round(prof[k], 4) for k in ("poc", "vah", "val"))
    return tuple(round(getattr(prof, k), 4) for k in ("poc", "vah", "val"))


def _ctx_signature(ctx):
    return {
        "levels": _levels_signature(ctx),
        "structure": {k: ctx.structure.get(k) for k in
                      ("state", "score", "high_state", "low_state", "last_event")},
        "vgwap": {k: (round(v, 4) if isinstance(v, float) else v) for k, v in ctx.vwap.items()},
        "patterns": [(p["name"], p["direction"], p.get("bars_ago")) for p in ctx.patterns],
        "sweeps": [(s["direction"], round(s["level"], 4), s["level_kind"]) for s in ctx.sweeps],
        "regime": {k: ctx.regime.get(k) for k in
                   ("vol_regime", "trend_regime", "direction", "strategy_mode", "atr_percentile", "adx")},
        "indicators": ctx.indicators,
        "profiles": {key: _profile_sig(ctx.profiles.get(key))
                     for key in ("session", "prior_session", "composite")},
        "zones": [(z["label"], round(z["low"], 4), round(z["high"], 4)) for z in ctx.zones],
    }


@pytest.mark.parametrize("index", [420, 777, 1500])
def test_context_matches_truncated_history(mnq_frame, mnq_inst, svc, index):
    full_prep = prepare(mnq_frame, mnq_inst)
    truncated = mnq_frame.upto(index + 1)
    trunc_prep = prepare(truncated, mnq_inst)
    caps = svc.capabilities("MNQ")

    ctx_full = build_context(full_prep, index, capabilities=caps)
    ctx_trunc = build_context(trunc_prep, index, capabilities=caps)
    assert _ctx_signature(ctx_full) == _ctx_signature(ctx_trunc), (
        "analysis at bar %d differs when future bars are removed -> look-ahead leak" % index
    )


def test_swings_are_only_available_after_confirmation(mnq_frame, mnq_inst):
    prep = prepare(mnq_frame, mnq_inst)
    assert prep.swings, "expected swings in the sample"
    for swing in prep.swings:
        assert swing.confirmed_index > swing.index
        # a context before confirmation must not list this swing
        before = swing.confirmed_index - 1
        if before <= 0:
            continue
        ctx = build_context(prep, before)
        prices = [lv["price"] for lv in ctx.levels if lv["kind"] == "swing"]
        if swing.price not in prices:
            continue
        # allowed only if another confirmed swing happens to share the price
        others = [s for s in prep.swings
                  if s.price == swing.price and s.confirmed_index <= before]
        assert others, f"swing at bar {swing.index} leaked into context at bar {before}"


def test_signal_is_identical_without_future_bars(mnq_frame, mnq_inst, svc, registry, funds, cfg):
    caps = svc.capabilities("MNQ")
    prep = prepare(mnq_frame, mnq_inst)
    # locate real signal bars first, so the assertion below can never be vacuous
    signal_bars: list[int] = []
    for index in range(len(mnq_frame) - 1200, len(mnq_frame)):
        ts = int(mnq_frame.ts[index])
        fund = funds.pack("MNQ", mnq_inst.sector, ts)
        res = evaluate(build_context(prep, index, fundamentals=fund, capabilities=caps, light=True),
                       registry, cfg, fund, caps)
        if res["state"] == "signal":
            signal_bars.append(index)
        if len(signal_bars) >= 3:
            break
    assert signal_bars, "no signals in the scan window - widen the window"

    for index in signal_bars:
        ts = int(mnq_frame.ts[index])
        fund = funds.pack("MNQ", mnq_inst.sector, ts)
        a = build_context(prep, index, fundamentals=fund, capabilities=caps)
        b = build_context(prepare(mnq_frame.upto(index + 1), mnq_inst), index,
                          fundamentals=fund, capabilities=caps)
        res_a = evaluate(a, registry, cfg, fund, caps)
        res_b = evaluate(b, registry, cfg, fund, caps)
        assert res_a["state"] == res_b["state"] == "signal"
        sa, sb = res_a["signal"], res_b["signal"]
        for key in ("direction", "strategy", "score", "invalidation"):
            assert sa[key] == sb[key]
        assert sa["entry"]["price"] == sb["entry"]["price"]
        assert sa["stop"]["price"] == sb["stop"]["price"]
        assert [t["price"] for t in sa["targets"]] == [t["price"] for t in sb["targets"]]
        assert res_a.get("best_score") == res_b.get("best_score")


def test_no_signal_uses_a_bar_after_its_index(mnq_frame, mnq_inst, svc, registry, funds, cfg):
    """Every signal's created_ts must equal the ts of the bar it was generated on."""
    caps = svc.capabilities("MNQ")
    prep = prepare(mnq_frame, mnq_inst)
    for index in range(len(mnq_frame) - 600, len(mnq_frame), 5):
        ts = int(mnq_frame.ts[index])
        fund = funds.pack("MNQ", mnq_inst.sector, ts)
        ctx = build_context(prep, index, fundamentals=fund, capabilities=caps)
        res = evaluate(ctx, registry, cfg, fund, caps)
        if res["state"] == "signal":
            assert res["signal"]["created_ts"] == ts
            assert res["signal"]["created_ts"] <= int(mnq_frame.ts[index])


def test_backtest_is_reproducible(cfg, book, registry, funds, svc):
    from app.backtest.engine import Backtester

    bt = Backtester(cfg, book, registry, funds, svc)
    first = bt.run("MNQ", "5m", bars=700)
    second = bt.run("MNQ", "5m", bars=700)
    assert first["reproducible_hash"] == second["reproducible_hash"]
    assert len(first["trades"]) == len(second["trades"])
