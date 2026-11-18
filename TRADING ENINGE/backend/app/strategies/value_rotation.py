"""Value area rotation: fade the value edge back toward the POC after re-entry."""
from __future__ import annotations

from ..analysis.context import Context
from .base import SignalCandidate, Strategy, build_targets, stop_beyond


class ValueRotation(Strategy):
    name = "value_rotation"
    label = "Value area rotation"
    family = "contra_trend"
    requires = ["candles"]

    def evaluate(self, ctx: Context) -> SignalCandidate | None:
        prof = ctx.profiles.get("session") or ctx.profiles.get("prior_session")
        if prof is None:
            return None
        atr = ctx.atr
        inst = ctx.inst
        if atr <= 0:
            return None
        i = ctx.index
        if i < 1:
            return None
        prep = ctx.prep
        prev_close = float(prep.frame.close[i - 1])
        close = ctx.price
        width = prof.vah - prof.val
        if width < self.p("min_value_width_atr", 0.8) * atr:
            return None

        # re-entry from above -> short back to POC; from below -> long back to POC
        if prev_close > prof.vah and close < prof.vah:
            direction = "short"
            entry = inst.round_tick(prof.vah)
            anchor = max(float(prep.frame.high[max(0, i - 6):i + 1].max()), prof.vah)
            stop = stop_beyond(ctx, "short", anchor, self.p("stop_atr", 0.7))
            edge_label = "VAH"
        elif prev_close < prof.val and close > prof.val:
            direction = "long"
            entry = inst.round_tick(prof.val)
            anchor = min(float(prep.frame.low[max(0, i - 6):i + 1].min()), prof.val)
            stop = stop_beyond(ctx, "long", anchor, self.p("stop_atr", 0.7))
            edge_label = "VAL"
        else:
            return None

        if abs(close - entry) > self.p("max_extension_atr", 1.6) * atr:
            return None
        if direction == "long" and stop >= entry - inst.tick_size * 2:
            return None
        if direction == "short" and stop <= entry + inst.tick_size * 2:
            return None

        targets, target_reasons = build_targets(ctx, direction, entry, stop, [0.8, 1.4, 2.2])
        # make the POC the first target: that is the rotation objective
        poc_target = inst.round_tick(prof.poc)
        if (direction == "long" and poc_target > entry + inst.tick_size * 4) or \
           (direction == "short" and poc_target < entry - inst.tick_size * 4):
            targets[0] = poc_target
            target_reasons[0] = f"POC at {inst.format_price(prof.poc)}, the rotation objective"
        reasons = [
            {"factor": "location", "detail": f"Price re-entered value through {edge_label} "
                                             f"({inst.format_price(prof.vah if direction == 'short' else prof.val)})"},
            {"factor": "profile", "detail": f"Value area {inst.format_price(prof.val)} to {inst.format_price(prof.vah)}, "
                                            f"POC {inst.format_price(prof.poc)}, width {width / atr:.2f} ATR"},
            {"factor": "regime", "detail": f"{ctx.regime.get('label')}, a mean-reversion setup"},
            {"factor": "structure", "detail": f"Structure {ctx.structure.get('state')} (fade only in range/transition)"},
        ]
        return SignalCandidate(
            strategy=self.name, label=self.label, family=self.family, direction=direction,
            entry=entry, stop=stop, targets=targets, entry_type="limit",
            entry_reason=f"Limit at {edge_label} on the retest of the value edge.",
            stop_reason=f"Outside the value area plus {self.p('stop_atr', 0.7):.2f} ATR. Acceptance outside value kills the rotation.",
            invalidation=f"Sustained trade outside {inst.format_price(stop)} means value is migrating, not rotating.",
            reasons=reasons, target_reasons=target_reasons, reference_level=edge_label,
            alternative_entry=inst.round_tick(prof.poc),
            requires=self.requires,
            meta={"value_area": {"poc": prof.poc, "vah": prof.vah, "val": prof.val}},
        )
