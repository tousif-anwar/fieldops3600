"""VWAP band fade, gated by a measured reversion half-life.

The z-score framework is standard: enter at |z| >= 2 from VWAP, target the mean,
stop at |z| >= ~3. What most implementations skip is the check that the
deviation actually reverts. The AR(1) half-life over the last 60 bars answers
that: if a stretch takes longer than `max_half_life` bars to decay by half, the
series is not reverting fast enough to fade inside a trading session, so the
setup is skipped instead of being forced.
"""
from __future__ import annotations

import numpy as np

from ..analysis.context import Context
from .base import SignalCandidate, Strategy, stop_beyond


class VwapMeanReversion(Strategy):
    name = "vwap_mean_reversion"
    label = "VWAP band fade"
    family = "contra_trend"
    requires = ["candles"]

    def evaluate(self, ctx: Context) -> SignalCandidate | None:
        vw = ctx.vwap or {}
        vwap = vw.get("vwap")
        sd = vw.get("sd")
        z = vw.get("z")
        inst = ctx.inst
        atr = ctx.atr
        if not vwap or not sd or sd <= 0 or z is None or atr <= 0:
            return None

        entry_z = self.p("entry_z", 2.0)
        stop_z = self.p("stop_z", 3.2)
        if abs(z) < entry_z:
            return None

        # measured reversion speed, not an assumption
        half_life = ctx.indicators.get("half_life")
        if half_life is None or half_life > self.p("max_half_life", 14):
            return None
        variance_ratio = ctx.regime.get("variance_ratio")
        if variance_ratio is not None and variance_ratio > self.p("max_variance_ratio", 1.15):
            return None

        price = ctx.price
        sign = 1.0 if z > 0 else -1.0
        direction = "short" if sign > 0 else "long"
        entry = inst.round_tick(price)
        stop = stop_beyond(ctx, direction, float(vwap) + sign * stop_z * float(sd), 0.0, 2)
        if direction == "long" and stop >= entry - inst.tick_size * 2:
            return None
        if direction == "short" and stop <= entry + inst.tick_size * 2:
            return None
        if abs(entry - stop) > atr * self.p("max_stop_atr", 3.0):
            return None

        # targets are the mean and the opposite bands: the reversion objective
        raw_targets = [
            (float(vwap), f"VWAP mean at {inst.format_price(vwap)}, the reversion objective"),
            (float(vwap) - sign * float(sd), "one standard deviation through the mean"),
            (float(vwap) - sign * 2 * float(sd), "two standard deviations through the mean"),
        ]
        targets: list[float] = []
        target_reasons: list[str] = []
        for level, reason in raw_targets:
            target = inst.round_tick(level)
            beyond = (direction == "long" and target > entry + inst.tick_size * 2) or \
                     (direction == "short" and target < entry - inst.tick_size * 2)
            if not beyond:
                continue
            if targets and ((direction == "long" and target <= targets[-1]) or
                            (direction == "short" and target >= targets[-1])):
                continue
            targets.append(target)
            target_reasons.append(reason)
        if not targets:
            return None

        risk = abs(entry - stop)
        first_rr = abs(targets[0] - entry) / risk if risk > 0 else 0.0
        reasons = [
            {"factor": "location", "detail": f"Price is {z:+.2f} standard deviations from VWAP "
                                            f"({inst.format_price(vwap)}), lane width {float(sd):.2f} points"},
            {"factor": "reversion", "detail": f"AR(1) half-life {half_life:.1f} bars over the last 60 bars"
                                             + (f", variance ratio {variance_ratio:.2f}" if variance_ratio is not None else "")},
            {"factor": "regime", "detail": f"{ctx.regime.get('label', 'unknown regime')}, "
                                          f"{str(ctx.regime.get('persistence', 'unknown')).replace('_', ' ')} persistence"},
            {"factor": "risk", "detail": f"Stop {stop_z:.1f}sd from VWAP, {inst.ticks(risk)} ticks of risk, "
                                        f"first target {first_rr:.2f}R"},
        ]
        return SignalCandidate(
            strategy=self.name, label=self.label, family=self.family, direction=direction,
            entry=entry, stop=stop, targets=targets, entry_type="limit",
            entry_reason=(f"Limit at {inst.format_price(entry)} on a {z:+.2f}sd stretch from VWAP, "
                          f"with a measured {half_life:.1f}-bar half-life."),
            stop_reason=(f"Beyond {stop_z:.1f} standard deviations from VWAP at {inst.format_price(stop)}: "
                         f"the stretch is not reverting, it is repricing."),
            invalidation=(f"A close through {inst.format_price(stop)} says this is a trend leg, "
                          f"not an overextension."),
            reasons=reasons, target_reasons=target_reasons, reference_level="VWAP",
            alternative_entry=inst.round_tick(vwap),
            requires=self.requires,
            meta={"z": z, "vwap": float(vwap), "sd": float(sd), "half_life": half_life,
                  "variance_ratio": variance_ratio},
        )
