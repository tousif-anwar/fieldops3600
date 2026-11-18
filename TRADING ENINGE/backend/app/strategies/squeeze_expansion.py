"""Volatility squeeze expansion: compressed bands, then a channel break.

Compression is measured on the 20-period Bollinger bandwidth ranked against its
own trailing year of bars, so a quiet range is identified relative to this
market's own volatility, not against a fixed width. The trigger is a close
through the trailing 20-bar Donchian channel with volume expansion, which is
the same "compressed volatility leads to directional expansion" edge the
breakout material describes: low win rate, large winners, only valid after a
squeeze.
"""
from __future__ import annotations

import numpy as np

from ..analysis.context import Context
from .base import SignalCandidate, Strategy, build_targets, stop_beyond


class SqueezeExpansion(Strategy):
    name = "squeeze_expansion"
    label = "Squeeze expansion"
    family = "momentum"
    requires = ["candles"]

    def evaluate(self, ctx: Context) -> SignalCandidate | None:
        prep = ctx.prep
        i = ctx.index
        inst = ctx.inst
        atr = ctx.atr
        if atr <= 0 or i < 25:
            return None

        # ---- the squeeze has to have happened recently, not right now -------
        lookback = max(1, int(self.p("squeeze_lookback", 6)))
        window = prep.bb_width_rank[max(0, i - lookback + 1):i + 1]
        window = window[np.isfinite(window)]
        if len(window) == 0 or float(window.min()) > self.p("squeeze_rank", 25):
            return None
        squeeze_rank = float(window.min())

        # ---- the expansion has to be starting on this bar -------------------
        dc_up = float(prep.dc_upper[i])
        dc_dn = float(prep.dc_lower[i])
        if not (np.isfinite(dc_up) and np.isfinite(dc_dn)):
            return None
        rel_volume = float(ctx.indicators.get("rel_volume") or 0.0)
        if rel_volume < self.p("min_relative_volume", 1.2):
            return None
        atr_pct = ctx.indicators.get("atr_percentile")
        if atr_pct is not None and atr_pct > self.p("max_atr_percentile", 92):
            return None
        if ctx.regime.get("vol_regime") == "extreme":
            return None

        price = ctx.price
        bar_high = float(ctx.bar["high"])
        bar_low = float(ctx.bar["low"])
        buffer_ = inst.tick_size * 2

        if price > dc_up:
            direction = "long"
            # stop entry just beyond the bar that broke the channel
            entry = inst.round_tick(max(bar_high, price) + buffer_)
            # invalidation is a close back inside the channel, so the anchor is
            # the channel edge; a bar that gapped clear of it uses its own low
            anchor = bar_low if bar_low > dc_up else dc_up - inst.tick_size
            stop = stop_beyond(ctx, "long", anchor, self.p("stop_atr", 0.6), 2)
            break_label = "upper"
        elif price < dc_dn:
            direction = "short"
            entry = inst.round_tick(min(bar_low, price) - buffer_)
            anchor = bar_high if bar_high < dc_dn else dc_dn + inst.tick_size
            stop = stop_beyond(ctx, "short", anchor, self.p("stop_atr", 0.6), 2)
            break_label = "lower"
        else:
            return None

        if direction == "long" and stop >= entry - inst.tick_size * 2:
            return None
        if direction == "short" and stop <= entry + inst.tick_size * 2:
            return None
        if abs(entry - stop) > atr * self.p("max_stop_atr", 2.5):
            return None

        targets, target_reasons = build_targets(ctx, direction, entry, stop, [1.2, 2.2, 3.5])
        reasons = [
            {"factor": "volatility", "detail": f"Bollinger bandwidth sat in the {squeeze_rank:.0f}th "
                                              f"percentile within the last {lookback} bars (compression)"},
            {"factor": "breakout", "detail": f"Close broke the {break_label} 20-bar channel at "
                                            f"{inst.format_price(dc_up if direction == 'long' else dc_dn)}"},
            {"factor": "volume", "detail": f"Relative volume {rel_volume:.2f}x on the break; expansion needs participation"},
            {"factor": "regime", "detail": f"{ctx.regime.get('label', 'unknown regime')}, "
                                          f"ATR at the {atr_pct:.0f}th percentile" if atr_pct is not None
                                          else ctx.regime.get("label", "unknown regime")},
        ]
        return SignalCandidate(
            strategy=self.name, label=self.label, family=self.family, direction=direction,
            entry=entry, stop=stop, targets=targets, entry_type="stop",
            entry_reason=(f"Stop entry beyond the {break_label} channel break at {inst.format_price(entry)} "
                          f"after a {squeeze_rank:.0f}th-percentile bandwidth squeeze."),
            stop_reason=(f"Back inside the channel at {inst.format_price(anchor)} plus a "
                         f"{self.p('stop_atr', 0.6):.2f} ATR buffer. A failed expansion returns to the range."),
            invalidation=(f"A close back through {inst.format_price(stop)} means the break was absorbed "
                          f"and the range still holds."),
            reasons=reasons, target_reasons=target_reasons, reference_level="Donchian channel",
            alternative_entry=inst.round_tick(price),
            requires=self.requires,
            meta={"squeeze_rank": squeeze_rank, "channel": {"upper": dc_up, "lower": dc_dn},
                  "relative_volume": rel_volume},
        )
