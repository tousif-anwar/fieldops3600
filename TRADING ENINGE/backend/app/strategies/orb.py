"""Opening range breakout with retest."""
from __future__ import annotations

from ..analysis.context import Context
from .base import SignalCandidate, Strategy, build_targets, stop_beyond


class OpeningRangeBreakout(Strategy):
    name = "opening_range_breakout"
    label = "Opening range breakout + retest"
    family = "momentum"
    requires = ["candles"]

    def evaluate(self, ctx: Context) -> SignalCandidate | None:
        prep = ctx.prep
        i = ctx.index
        td = int(prep.td_index[i])
        oe = prep.orb_end_idx.get(td)
        if oe is None or i < oe:
            return None
        orh = float(prep.or_high_run[i]) if prep.or_high_run[i] == prep.or_high_run[i] else None
        orl = float(prep.or_low_run[i]) if prep.or_low_run[i] == prep.or_low_run[i] else None
        if orh is None or orl is None or orh <= orl:
            return None
        atr = ctx.atr
        inst = ctx.inst
        if atr <= 0:
            return None
        or_range = orh - orl
        if or_range < self.p("min_range_atr", 0.25) * atr:
            return None
        max_retest = int(self.p("max_retest_bars", 8))
        price = ctx.price

        broke_up = prep.bars_since(i, orh, "above")
        broke_down = prep.bars_since(i, orl, "below")
        direction = None
        if broke_up is not None and 0 <= broke_up <= max_retest and price > orh and abs(price - orh) <= atr * 0.6:
            direction = "long"
        elif broke_down is not None and 0 <= broke_down <= max_retest and price < orl and abs(price - orl) <= atr * 0.6:
            direction = "short"
        if direction is None:
            return None

        if direction == "long":
            entry = inst.round_tick(orh)
            stop = stop_beyond(ctx, "long", min(orl, orh - atr * self.p("stop_atr", 0.75)), 0.25, 2)
        else:
            entry = inst.round_tick(orl)
            stop = stop_beyond(ctx, "short", max(orh, orl + atr * self.p("stop_atr", 0.75)), 0.25, 2)
        if direction == "long" and stop >= entry - inst.tick_size * 2:
            return None
        if direction == "short" and stop <= entry + inst.tick_size * 2:
            return None

        targets, target_reasons = build_targets(ctx, direction, entry, stop, [1.0, 2.0, 3.0])
        reasons = [
            {"factor": "location", "detail": f"Opening range {inst.format_price(orl)} to {inst.format_price(orh)} "
                                             f"({or_range / atr:.2f} ATR wide) broke {'up' if direction == 'long' else 'down'}"},
            {"factor": "retest", "detail": f"Price is back at the {'ORH' if direction == 'long' else 'ORL'} retest, "
                                          f"{broke_up if direction == 'long' else broke_down} bars after the break"},
            {"factor": "session", "detail": f"{ctx.timing_reason}. Breakouts need participation."},
            {"factor": "volume", "detail": f"Relative volume {ctx.indicators.get('rel_volume') or 0:.2f}x"},
        ]
        return SignalCandidate(
            strategy=self.name, label=self.label, family=self.family, direction=direction,
            entry=entry, stop=stop, targets=targets, entry_type="limit",
            entry_reason=f"Limit at the {'ORH' if direction == 'long' else 'ORL'} retest after the opening-range break.",
            stop_reason=f"Back inside the opening range, beyond the opposite edge with an ATR buffer.",
            invalidation=f"Price re-entering the opening range and closing through {inst.format_price(stop)} voids the breakout.",
            reasons=reasons, target_reasons=target_reasons, reference_level="opening range",
            alternative_entry=inst.round_tick(float(ctx.bar["high"]) + inst.tick_size * 2 if direction == "long"
                                              else float(ctx.bar["low"]) - inst.tick_size * 2),
            requires=self.requires,
            meta={"or_high": orh, "or_low": orl, "or_range": or_range},
        )
