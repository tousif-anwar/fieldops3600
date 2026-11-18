"""Strategy registry: toggles, capability gating and shared evaluation."""
from __future__ import annotations

from ..config import Config
from .absorption_reversal import AbsorptionReversal
from .base import SignalCandidate, Strategy
from .orb import OpeningRangeBreakout
from .squeeze_expansion import SqueezeExpansion
from .sweep_reversal import SweepReversal
from .trend_pullback import TrendPullback
from .value_rotation import ValueRotation
from .vwap_mean_reversion import VwapMeanReversion

CLASSES: dict[str, type[Strategy]] = {
    "trend_pullback": TrendPullback,
    "sweep_reversal": SweepReversal,
    "value_rotation": ValueRotation,
    "opening_range_breakout": OpeningRangeBreakout,
    "absorption_reversal": AbsorptionReversal,
    "squeeze_expansion": SqueezeExpansion,
    "vwap_mean_reversion": VwapMeanReversion,
}


class StrategyRegistry:
    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        self.last_errors: list[str] = []

    def meta(self) -> dict:
        return self.cfg.strategies()

    def build(self, name: str) -> Strategy:
        meta = self.meta()[name]
        return CLASSES[name](meta.get("params", {}))

    def active(self, capabilities=None) -> list[Strategy]:
        out = []
        for name, meta in self.meta().items():
            if not meta.get("enabled", True):
                continue
            if name not in CLASSES:
                continue
            needs = list(meta.get("requires", []))
            if capabilities is not None and hasattr(capabilities, "has"):
                if any(not capabilities.has(c) for c in needs):
                    continue
            out.append(self.build(name))
        return out

    def disabled(self, capabilities=None) -> list[dict]:
        out = []
        for name, meta in self.meta().items():
            if name not in CLASSES:
                continue
            needs = list(meta.get("requires", []))
            missing = []
            if capabilities is not None and hasattr(capabilities, "has"):
                missing = [c for c in needs if not capabilities.has(c)]
            if missing:
                out.append({
                    "name": name, "label": meta.get("label", name),
                    "reason": f"disabled: requires {', '.join(missing)} data the current feed does not provide",
                    "missing": missing,
                })
            elif not meta.get("enabled", True):
                out.append({"name": name, "label": meta.get("label", name),
                            "reason": "disabled by configuration", "missing": []})
        return out

    def evaluate_all(self, ctx) -> list[SignalCandidate]:
        out: list[SignalCandidate] = []
        self.last_errors = []
        for strat in self.active(ctx.capabilities):
            try:
                cand = strat.evaluate(ctx)
            except Exception as exc:  # a broken module must not kill the engine
                self.last_errors.append(f"{strat.name}: {type(exc).__name__}: {exc}")
                cand = None
            if cand is not None:
                out.append(cand)
        return out
