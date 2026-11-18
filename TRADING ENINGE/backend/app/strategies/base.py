"""Strategy interface. Every module implements evaluate(context) -> SignalCandidate | None."""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from ..analysis.context import Context


@dataclass
class SignalCandidate:
    strategy: str
    label: str
    family: str              # momentum | contra_trend
    direction: str           # long | short
    entry: float
    stop: float
    targets: list[float]
    entry_type: str          # limit | stop
    entry_reason: str
    stop_reason: str
    invalidation: str
    reasons: list[dict] = field(default_factory=list)
    target_reasons: list[str] = field(default_factory=list)
    alternative_entry: float | None = None
    reference_level: str | None = None
    requires: list[str] = field(default_factory=list)
    meta: dict = field(default_factory=dict)

    def risk_points(self) -> float:
        return abs(self.entry - self.stop)

    def rr(self, target: float | None = None) -> float:
        r = self.risk_points()
        if r <= 0:
            return 0.0
        t = self.targets[0] if target is None else target
        return abs(t - self.entry) / r


class Strategy(ABC):
    name = "base"
    label = "Base"
    family = "momentum"
    requires: list[str] = []

    def __init__(self, params: dict | None = None) -> None:
        self.params = params or {}

    def p(self, key: str, default: float) -> float:
        try:
            return float(self.params.get(key, default))
        except (TypeError, ValueError):
            return float(default)

    @abstractmethod
    def evaluate(self, ctx: Context) -> SignalCandidate | None:
        ...


# --------------------------------------------------------------------- helpers
def build_targets(ctx: Context, direction: str, entry: float, stop: float,
                  atr_mults: list[float], max_targets: int = 3,
                  min_rr: float = 1.5) -> tuple[list[float], list[str]]:
    """Structure-aware targets: levels first, ATR multiples as fallback.

    `min_rr` keeps the nearest structural level from becoming a first target
    that the engine will reject anyway: a level inside the minimum reward:risk
    is not a target, so the search starts past it.
    """
    inst = ctx.inst
    tick = inst.tick_size
    risk = abs(entry - stop)
    atr = max(ctx.atr, tick * 4)
    if risk <= 0:
        risk = atr
    if direction == "long":
        pool = [lv for lv in ctx.levels
                if lv["price"] > entry + tick * 2 and lv["strength"] >= 0.45
                and lv["kind"] not in {"round", "lvn"}]
        pool.sort(key=lambda lv: lv["price"])
    else:
        pool = [lv for lv in ctx.levels
                if lv["price"] < entry - tick * 2 and lv["strength"] >= 0.45
                and lv["kind"] not in {"round", "lvn"}]
        pool.sort(key=lambda lv: -lv["price"])

    targets: list[float] = []
    reasons: list[str] = []
    min_r = [m * atr for m in atr_mults]
    # T1 must stay reachable: cap it at 2R so a "first target" is not a fantasy
    ceiling = [risk * 2.0, risk * 3.5, risk * 5.0]
    for k, mult in enumerate(atr_mults):
        floor_dist = max(min_r[k], risk * max(min_rr, 1.0 + 0.6 * k))
        picked = None
        best_dist = None
        for lv in pool:
            dist = abs(lv["price"] - entry)
            if dist < floor_dist * 0.9 or dist > ceiling[k]:
                continue
            if any(abs(lv["price"] - t) < tick * 2 for t in targets):
                continue
            if best_dist is None or dist < best_dist:
                picked, best_dist = lv, dist
        if picked is not None:
            targets.append(inst.round_tick(picked["price"]))
            reasons.append(f"{picked['label']} at {inst.format_price(picked['price'])} "
                           f"(R:R {abs(picked['price'] - entry) / risk:.1f})")
        else:
            dist = min(floor_dist, ceiling[k])
            p = entry + (1 if direction == "long" else -1) * dist
            targets.append(inst.round_tick(p))
            reasons.append(f"{dist / atr:.1f}x ATR projection at {inst.format_price(p)}")
    # enforce monotonic targets and a minimum separation
    for i in range(1, len(targets)):
        if direction == "long" and targets[i] <= targets[i - 1] + tick:
            targets[i] = inst.round_tick(targets[i - 1] + max(tick * 4, risk * 0.8))
        if direction == "short" and targets[i] >= targets[i - 1] - tick:
            targets[i] = inst.round_tick(targets[i - 1] - max(tick * 4, risk * 0.8))
    return targets[:max_targets], reasons[:max_targets]


def stop_beyond(ctx: Context, direction: str, level: float, atr_mult: float, extra_ticks: float = 2) -> float:
    inst = ctx.inst
    atr = max(ctx.atr, inst.tick_size * 4)
    buf = atr * atr_mult + inst.tick_size * extra_ticks
    return inst.round_tick(level - buf if direction == "long" else level + buf)


def last_swing(ctx: Context, kind: str, direction: str | None = None) -> float | None:
    swings = [s for s in ctx.structure.get(f"swing_{'highs' if kind == 'high' else 'lows'}", [])]
    if not swings:
        return None
    return float(swings[-1]["price"])
