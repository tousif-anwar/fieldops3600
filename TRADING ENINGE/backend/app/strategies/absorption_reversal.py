"""Absorption / probable-iceberg reversal. Requires trades (and depth for icebergs)."""
from __future__ import annotations

from ..analysis.context import Context
from .base import SignalCandidate, Strategy, build_targets, stop_beyond


class AbsorptionReversal(Strategy):
    name = "absorption_reversal"
    label = "Absorption / iceberg reversal"
    family = "contra_trend"
    requires = ["trades", "depth"]

    def evaluate(self, ctx: Context) -> SignalCandidate | None:
        of = ctx.orderflow or {}
        if not of.get("available"):
            return None
        atr = ctx.atr
        inst = ctx.inst
        if atr <= 0:
            return None

        absorption = of.get("absorption")
        icebergs = [x for x in (of.get("icebergs") or [])
                    if x["evidence_count"] >= self.p("min_iceberg_evidence", 3)]
        direction = None
        price = None
        zone_low = zone_high = None
        evidence: list[dict] = []

        if absorption and absorption["confidence"] >= self.p("min_absorption_score", 0.55):
            direction = "long" if absorption["side"] == "bid" else "short"
            price = absorption["price"]
            zone_low, zone_high = absorption["zone_low"], absorption["zone_high"]
            evidence.append({"factor": "absorption", "detail": absorption["evidence"]})
        elif icebergs:
            best = max(icebergs, key=lambda x: x["confidence"])
            direction = "long" if best["side"] == "bid" else "short"
            price = best["price"]
            zone_low = zone_high = best["price"]
            evidence.append({"factor": "iceberg", "detail": best["evidence"] + " (heuristic)"})
        else:
            return None

        if direction is None:
            return None
        entry = inst.round_tick(price)
        stop = stop_beyond(ctx, direction, zone_low if direction == "long" else zone_high,
                           self.p("stop_atr", 0.8), 2)
        if direction == "long" and stop >= entry - inst.tick_size * 2:
            return None
        if direction == "short" and stop <= entry + inst.tick_size * 2:
            return None

        targets, target_reasons = build_targets(ctx, direction, entry, stop, [1.0, 1.8, 2.8])
        reasons = evidence + [
            {"factor": "flow", "detail": f"Bar delta {of.get('delta')}, cumulative delta {of.get('cumulative_delta')}"},
            {"factor": "location", "detail": f"Defended level at {inst.format_price(entry)} "
                                             f"(heuristic, confidence "
                                             f"{(absorption or icebergs[0]).get('confidence') if absorption else icebergs[0]['confidence']:.2f})"},
        ]
        return SignalCandidate(
            strategy=self.name, label=self.label, family=self.family, direction=direction,
            entry=entry, stop=stop, targets=targets, entry_type="limit",
            entry_reason=f"Limit at the absorbed level {inst.format_price(entry)} on the retest.",
            stop_reason="Beyond the absorption zone. If it breaks, the resting order was consumed.",
            invalidation="Loss of the defended level with rising opposite delta invalidates the absorption read.",
            reasons=reasons, target_reasons=target_reasons, reference_level="absorption",
            requires=self.requires,
            meta={"absorption": absorption, "icebergs": icebergs[:3]},
        )
