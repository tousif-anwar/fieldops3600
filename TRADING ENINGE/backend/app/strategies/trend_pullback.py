"""Trend pullback: with structure, after a pullback to VWAP / EMA / POC."""
from __future__ import annotations

from ..analysis.context import Context
from .base import SignalCandidate, Strategy, build_targets, last_swing, stop_beyond


class TrendPullback(Strategy):
    name = "trend_pullback"
    label = "Trend pullback"
    family = "momentum"
    requires = ["candles"]

    def evaluate(self, ctx: Context) -> SignalCandidate | None:
        st = ctx.structure
        score = float(st.get("score", 0.0))
        if score >= 0.2:
            direction = "long"
        elif score <= -0.2:
            direction = "short"
        else:
            return None

        atr = ctx.atr
        inst = ctx.inst
        if atr <= 0:
            return None
        prep = ctx.prep
        i = ctx.index
        price = ctx.price
        pullback_min = self.p("pullback_atr", 0.35) * atr
        max_dist = self.p("max_distance_atr", 1.2) * atr

        refs: list[tuple[str, float]] = []
        if ctx.vwap.get("vwap"):
            refs.append(("VWAP", float(ctx.vwap["vwap"])))
        for key, name in (("ema21", "EMA21"), ("ema50", "EMA50")):
            v = ctx.indicators.get(key)
            if v:
                refs.append((name, float(v)))
        prof = ctx.profiles.get("session")
        if prof is not None:
            refs.append(("session POC", float(prof.poc)))
        prior = ctx.profiles.get("prior_session")
        if prior is not None:
            refs.append(("prior POC", float(prior.poc)))

        window = max(0, i - 24)
        recent_high = float(prep.frame.high[window:i + 1].max())
        recent_low = float(prep.frame.low[window:i + 1].min())

        if direction == "long":
            if (recent_high - price) < pullback_min:
                return None
            candidates = [(n, r) for n, r in refs if r < price and (price - r) <= max_dist]
            if not candidates:
                return None
            ref_name, ref = max(candidates, key=lambda x: x[1])
            swing_low = last_swing(ctx, "low")
            stop_anchor = min(ref, swing_low) if swing_low else ref
            if price - stop_anchor > atr * 2.2:
                stop_anchor = ref
            stop = stop_beyond(ctx, "long", stop_anchor, self.p("stop_atr", 0.9))
            if stop >= price - inst.tick_size * 2:
                return None
            entry = inst.round_tick(ref)
        else:
            if (price - recent_low) < pullback_min:
                return None
            candidates = [(n, r) for n, r in refs if r > price and (r - price) <= max_dist]
            if not candidates:
                return None
            ref_name, ref = min(candidates, key=lambda x: x[1])
            swing_high = last_swing(ctx, "high")
            stop_anchor = max(ref, swing_high) if swing_high else ref
            if stop_anchor - price > atr * 2.2:
                stop_anchor = ref
            stop = stop_beyond(ctx, "short", stop_anchor, self.p("stop_atr", 0.9))
            if stop <= price + inst.tick_size * 2:
                return None
            entry = inst.round_tick(ref)

        targets, target_reasons = build_targets(ctx, direction, entry, stop, [1.0, 1.8, 2.8])
        deeper = "higher low" if direction == "long" else "lower high"
        reasons = [
            {"factor": "structure", "detail": f"Structure is {st['state'].replace('_', ' ')} "
                                               f"({st.get('high_state')}/{st.get('low_state')})"},
            {"factor": "location", "detail": f"Pullback of {(recent_high - price if direction == 'long' else price - recent_low):.2f} points "
                                              f"({((recent_high - price) if direction == 'long' else (price - recent_low)) / atr:.2f} ATR) into {ref_name}"},
            {"factor": "trend", "detail": f"Entry at {ref_name} {inst.format_price(ref)}, "
                                          f"{(price - ref) / atr if direction == 'long' else (ref - price) / atr:.2f} ATR away"},
            {"factor": "volume", "detail": f"Relative volume {ctx.indicators.get('rel_volume') or 0:.2f}x on the pullback"},
        ]
        return SignalCandidate(
            strategy=self.name, label=self.label, family=self.family, direction=direction,
            entry=entry, stop=stop, targets=targets, entry_type="limit",
            entry_reason=f"Limit at {ref_name} ({inst.format_price(ref)}) on the pullback into value.",
            stop_reason=(f"Beyond the {deeper} / {ref_name} with a {self.p('stop_atr', 0.9):.2f} ATR buffer "
                         f"({inst.ticks(abs(entry - stop))} ticks)."),
            invalidation=(f"Close beyond {inst.format_price(stop)} invalidates the pullback; "
                          f"structure would flip against the position."),
            reasons=reasons, target_reasons=target_reasons, reference_level=ref_name,
            alternative_entry=inst.round_tick(float(ctx.bar["high"]) + inst.tick_size * 2
                                              if direction == "long"
                                              else float(ctx.bar["low"]) - inst.tick_size * 2),
            requires=self.requires, meta={"reference": ref_name, "reference_price": ref},
        )
