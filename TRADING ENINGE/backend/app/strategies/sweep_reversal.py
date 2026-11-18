"""Liquidity sweep reversal: stop run through a level, then reclaim."""
from __future__ import annotations

from ..analysis.context import Context
from .base import SignalCandidate, Strategy, build_targets, stop_beyond


class SweepReversal(Strategy):
    name = "sweep_reversal"
    label = "Liquidity sweep reversal"
    family = "contra_trend"
    requires = ["candles"]

    def evaluate(self, ctx: Context) -> SignalCandidate | None:
        if not ctx.sweeps:
            return None
        min_conf = self.p("min_score", 0.4)
        best = max(ctx.sweeps, key=lambda s: s["confidence"])
        if best["confidence"] < min_conf:
            return None
        if best.get("bars_ago", 0) > 1:
            return None
        atr = ctx.atr
        inst = ctx.inst
        if atr <= 0:
            return None

        direction = "long" if best["direction"] == "bull" else "short"
        prep = ctx.prep
        i = ctx.index
        sweep_bar_index = i - int(best.get("bars_ago", 0))
        sweep_low = float(prep.frame.low[max(0, sweep_bar_index)])
        sweep_high = float(prep.frame.high[max(0, sweep_bar_index)])

        if direction == "long":
            entry = inst.round_tick(float(ctx.bar["high"]) + inst.tick_size * 2)
            stop = stop_beyond(ctx, "long", min(sweep_low, float(best["level"])), self.p("stop_atr", 0.8), 2)
        else:
            entry = inst.round_tick(float(ctx.bar["low"]) - inst.tick_size * 2)
            stop = stop_beyond(ctx, "short", max(sweep_high, float(best["level"])), self.p("stop_atr", 0.8), 2)

        if direction == "long" and stop >= entry - inst.tick_size * 2:
            return None
        if direction == "short" and stop <= entry + inst.tick_size * 2:
            return None

        targets, target_reasons = build_targets(ctx, direction, entry, stop, [1.0, 1.8, 2.8])
        reasons = [
            {"factor": "liquidity", "detail": best["evidence"]},
            {"factor": "level", "detail": f"Swept {best['level_label']} at {inst.format_price(best['level'])}"},
            {"factor": "confirmation", "detail": f"Reclaimed the level and closed back inside "
                                                 f"({inst.ticks(best['close_back'])} ticks), confidence {best['confidence']:.2f}"},
            {"factor": "volume", "detail": f"Stop-run volume {best['volume_ratio']:.2f}x the 20-bar average"},
        ]
        return SignalCandidate(
            strategy=self.name, label=self.label, family=self.family, direction=direction,
            entry=entry, stop=stop, targets=targets, entry_type="stop",
            entry_reason=(f"Stop entry on continuation {'above' if direction == 'long' else 'below'} the reclaim bar "
                          f"- waits for follow-through after the stop run."),
            stop_reason=(f"Beyond the sweep extreme ({inst.format_price(sweep_low if direction == 'long' else sweep_high)}) "
                         f"- if price returns there the sweep failed."),
            invalidation=(f"A close back {'below' if direction == 'long' else 'above'} "
                          f"{inst.format_price(stop)} means the stop run was distribution, not a reversal."),
            reasons=reasons, target_reasons=target_reasons,
            reference_level=best["level_label"],
            alternative_entry=inst.round_tick(float(best["level"])),
            requires=self.requires,
            meta={"sweep": best},
        )
