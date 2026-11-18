"""Adapter interface + capability model.

Honesty rules enforced here:
  * every adapter declares what it can actually deliver (candles / trades / depth)
  * features declare their data requirements
  * callers get an explicit reason when a feature is unavailable
  * nothing fabricates data: unavailable means unavailable
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass, field

from .frame import CandleFrame

# feature -> required adapter capabilities
FEATURE_REQUIREMENTS: dict[str, tuple[str, ...]] = {
    "footprint": ("trades",),
    "delta": ("trades",),
    "cumulative_delta": ("trades",),
    "absorption": ("trades",),
    "stacked_imbalance": ("trades",),
    "iceberg": ("depth",),
    "depth_snapshot": ("depth",),
}

FEATURE_LABELS = {
    "footprint": "Footprint chart",
    "delta": "Bar delta",
    "cumulative_delta": "Cumulative delta",
    "absorption": "Absorption detection",
    "stacked_imbalance": "Stacked imbalance detection",
    "iceberg": "Probable iceberg detection",
    "depth_snapshot": "Level 2 depth",
}


@dataclass(frozen=True)
class Capabilities:
    candles: bool = True
    trades: bool = False
    depth: bool = False
    live: bool = False
    delayed: bool = False
    synthetic: bool = False
    historical: bool = True
    provider: str = "unknown"
    notes: tuple[str, ...] = ()

    def has(self, capability: str) -> bool:
        return bool(getattr(self, capability, False))

    def missing_for(self, feature: str) -> list[str]:
        return [c for c in FEATURE_REQUIREMENTS.get(feature, ()) if not self.has(c)]

    def feature_status(self) -> dict[str, dict]:
        out = {}
        for feature, req in FEATURE_REQUIREMENTS.items():
            missing = [c for c in req if not self.has(c)]
            out[feature] = {
                "label": FEATURE_LABELS.get(feature, feature),
                "available": not missing,
                "requires": list(req),
                "missing": missing,
                "reason": (
                    None if not missing
                    else f"needs {', '.join(missing)} data this feed does not provide"
                ),
            }
        return out

    def dict(self) -> dict:
        d = asdict(self)
        d["notes"] = list(self.notes)
        d["features"] = self.feature_status()
        return d


@dataclass(frozen=True)
class Trade:
    ts: float
    price: float
    size: float
    side: int  # +1 buy (at ask / lifted), -1 sell (at bid / hit), 0 unknown
    aggressor: str = "unknown"


@dataclass(frozen=True)
class DepthEvent:
    """One price level's displayed-vs-filled behaviour over a window.

    Used by the iceberg heuristic (probable, never certain).
    """
    ts: float
    price: float
    side: str  # 'bid' | 'ask'
    displayed: float
    filled: float
    refreshes: int


@dataclass(frozen=True)
class DepthSnapshot:
    ts: float
    bids: tuple[tuple[float, float], ...]
    asks: tuple[tuple[float, float], ...]


class DataError(RuntimeError):
    pass


class FeatureUnavailable(DataError):
    def __init__(self, feature: str, missing: list[str], provider: str) -> None:
        self.feature = feature
        self.missing = missing
        super().__init__(
            f"'{feature}' requires {', '.join(missing)} data; provider '{provider}' does not supply it"
        )


class DataAdapter(ABC):
    provider_id: str = "base"
    capabilities: Capabilities = Capabilities()

    @abstractmethod
    def get_candles(self, symbol: str, timeframe: str, limit: int | None = None) -> CandleFrame:
        ...

    # --------------------------- optional, capability-gated -----------------
    def get_trades(self, symbol: str, start: float, end: float) -> list[Trade]:
        missing = [c for c in ("trades",) if not self.capabilities.has(c)]
        raise FeatureUnavailable("trades", missing or ["trades"], self.provider_id)

    def get_depth_events(self, symbol: str, start: float, end: float) -> list[DepthEvent]:
        missing = [c for c in ("depth",) if not self.capabilities.has(c)]
        raise FeatureUnavailable("depth", missing or ["depth"], self.provider_id)

    def get_depth_snapshot(self, symbol: str, ts: float | None = None) -> DepthSnapshot:
        raise FeatureUnavailable("depth_snapshot", ["depth"], self.provider_id)

    def advance(self, symbol: str, timeframe: str) -> CandleFrame | None:
        """Live tick. Return a new frame when new bars exist, else None."""
        return None

    def health(self) -> dict:
        return {
            "provider": self.provider_id,
            "ok": True,
            "capabilities": self.capabilities.dict(),
            "detail": "static adapter",
        }

    def describe(self) -> dict:
        return {
            "provider": self.provider_id,
            "capabilities": self.capabilities.dict(),
            "notes": list(self.capabilities.notes),
        }


def quality_report(frame: CandleFrame, timeframe: str, stale_after: float = 180) -> dict:
    """Data-quality warnings surfaced prominently in the UI.

    Detects: empty history, gaps vs the expected bar interval, stale last bar,
    duplicate timestamps and zero-volume bars (a common bad-export symptom).
    """
    import time as _time

    warnings: list[dict] = []
    if len(frame) == 0:
        return {
            "bars": 0, "warnings": [{"level": "error", "code": "empty",
                                     "message": "No candles available for this market/timeframe."}],
            "last_bar_age_seconds": None, "gaps": [], "synthetic": frame.synthetic,
        }

    from .frame import TIMEFRAMES

    step = TIMEFRAMES[frame.timeframe]
    now = _time.time()
    age = max(0.0, now - int(frame.ts[-1]))
    # the newest *closed* bar is legitimately up to one interval old, so a flat
    # 3-minute threshold would cry wolf on every 5m+ chart
    stale_after = max(stale_after, 4 * 86400 if frame.timeframe == "1d" else 1.5 * step)
    if age > stale_after:
        warnings.append({
            "level": "warn" if frame.timeframe != "1d" else "info", "code": "stale",
            "message": f"Last bar is {int(age // 60)} min old (threshold {int(stale_after // 60)} min). Feed may be stale.",
        })

    dt = np_diff = None
    import numpy as np  # local import keeps module import cheap

    diffs = np.diff(frame.ts)
    if len(diffs):
        dt = int(np.median(diffs))
        if dt > step * 1.5 and frame.timeframe != "1d":
            warnings.append({"level": "warn", "code": "spacing",
                             "message": f"Median bar spacing is {dt}s, expected {step}s. Wrong timeframe?"})
        missing = int(np.sum(diffs > step * 1.5))
        if missing:
            expr = float(missing) / max(1, len(diffs))
            if expr > 0.02:
                warnings.append({
                    "level": "warn" if expr > 0.1 else "info", "code": "gaps",
                    "message": f"{missing} session gaps (expected outside RTH); coverage {100 * (1 - expr):.1f}%.",
                })
        duplicates = int(np.sum(diffs == 0))
        if duplicates:
            warnings.append({"level": "error", "code": "duplicates",
                             "message": f"{duplicates} duplicate timestamps in the series."})
        negative = int(np.sum(diffs < 0))
        if negative:
            warnings.append({"level": "error", "code": "unordered",
                             "message": f"{negative} out-of-order timestamps."})

    zero_vol = int((frame.volume <= 0).sum())
    if zero_vol > max(3, len(frame) * 0.02):
        warnings.append({"level": "warn", "code": "zero_volume",
                         "message": f"{zero_vol} bars came through with zero volume. Check the export."})

    if frame.synthetic:
        warnings.append({"level": "info", "code": "synthetic",
                         "message": "SIMULATED feed: prices are synthetic. Never use for real decisions."})
    if frame.provider.startswith("yahoo"):
        warnings.append({"level": "warn", "code": "delayed",
                         "message": "Yahoo Finance data is delayed and intraday history is limited."})
    return {
        "bars": len(frame),
        "warnings": warnings,
        "last_bar_age_seconds": round(age, 1),
        "bar_interval_seconds": dt,
        "gaps": [],
        "synthetic": frame.synthetic,
        "provider": frame.provider,
    }
