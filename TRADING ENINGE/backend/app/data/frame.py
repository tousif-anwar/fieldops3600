"""Candle container + resampling.

Stored column-wise in numpy so the analysis/backtest hot path never goes
through pandas object columns.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Iterable

import numpy as np

from ..session import to_et

TIMEFRAMES: dict[str, int] = {
    "1m": 60,
    "5m": 300,
    "15m": 900,
    "30m": 1800,
    "1h": 3600,
    "2h": 7200,
    "4h": 14400,
    "1d": 86400,
}
TIMEFRAME_LABELS = {
    "1m": "1 minute", "5m": "5 minutes", "15m": "15 minutes", "30m": "30 minutes",
    "1h": "1 hour", "2h": "2 hours", "4h": "4 hours", "1d": "1 day",
}


def normalize_timeframe(tf: str | None) -> str:
    tf = (tf or "5m").lower().strip()
    if tf not in TIMEFRAMES:
        raise ValueError(f"unsupported timeframe '{tf}'; choose from {', '.join(TIMEFRAMES)}")
    return tf


@dataclass
class CandleFrame:
    symbol: str
    timeframe: str
    ts: np.ndarray
    open: np.ndarray
    high: np.ndarray
    low: np.ndarray
    close: np.ndarray
    volume: np.ndarray
    buy_volume: np.ndarray | None = None
    sell_volume: np.ndarray | None = None
    provider: str = "unknown"
    synthetic: bool = False
    meta: dict = field(default_factory=dict)

    def __len__(self) -> int:
        return int(self.ts.shape[0])

    @property
    def last(self) -> dict:
        i = len(self) - 1
        return {
            "time": int(self.ts[i]), "open": float(self.open[i]), "high": float(self.high[i]),
            "low": float(self.low[i]), "close": float(self.close[i]), "volume": float(self.volume[i]),
        }

    def upto(self, end: int | None = None) -> "CandleFrame":
        """Copy-free view of the first `end` bars. The only supported way to
        restrict history, which is what makes look-ahead testing possible."""
        end = len(self) if end is None else max(0, min(end, len(self)))
        return CandleFrame(
            symbol=self.symbol, timeframe=self.timeframe,
            ts=self.ts[:end], open=self.open[:end], high=self.high[:end],
            low=self.low[:end], close=self.close[:end], volume=self.volume[:end],
            buy_volume=None if self.buy_volume is None else self.buy_volume[:end],
            sell_volume=None if self.sell_volume is None else self.sell_volume[:end],
            provider=self.provider, synthetic=self.synthetic, meta=dict(self.meta),
        )

    def records(self, limit: int | None = None) -> list[dict]:
        start = 0 if limit is None else max(0, len(self) - limit)
        out = []
        for i in range(start, len(self)):
            row = {
                "time": int(self.ts[i]),
                "open": float(self.open[i]),
                "high": float(self.high[i]),
                "low": float(self.low[i]),
                "close": float(self.close[i]),
                "volume": float(self.volume[i]),
                "et": to_et(int(self.ts[i])).strftime("%Y-%m-%d %H:%M"),
            }
            if self.buy_volume is not None:
                row["buy_volume"] = float(self.buy_volume[i])
                row["sell_volume"] = float(self.sell_volume[i])
            out.append(row)
        return out

    def last_index_at(self, ts: float) -> int:
        """Index of the last bar with bar.ts <= ts (searchsorted, O(log n))."""
        return int(np.searchsorted(self.ts, ts, side="right") - 1)


def make_frame(
    symbol: str, timeframe: str, rows: Iterable[dict], provider: str, synthetic: bool = False, meta: dict | None = None
) -> CandleFrame:
    rows = sorted(rows, key=lambda r: r["time"])
    n = len(rows)
    if n == 0:
        return CandleFrame(
            symbol=symbol, timeframe=timeframe, ts=np.zeros(0, dtype=np.int64),
            open=np.zeros(0), high=np.zeros(0), low=np.zeros(0), close=np.zeros(0),
            volume=np.zeros(0), provider=provider, synthetic=synthetic, meta=meta or {},
        )
    ts = np.array([int(r["time"]) for r in rows], dtype=np.int64)
    o = np.array([float(r["open"]) for r in rows], dtype=np.float64)
    h = np.array([float(r["high"]) for r in rows], dtype=np.float64)
    lo = np.array([float(r["low"]) for r in rows], dtype=np.float64)
    c = np.array([float(r["close"]) for r in rows], dtype=np.float64)
    v = np.array([float(r.get("volume", 0) or 0) for r in rows], dtype=np.float64)
    bv = sv = None
    if all(r.get("buy_volume") is not None and r.get("sell_volume") is not None for r in rows):
        bv = np.array([float(r["buy_volume"]) for r in rows], dtype=np.float64)
        sv = np.array([float(r["sell_volume"]) for r in rows], dtype=np.float64)
    return CandleFrame(
        symbol=symbol, timeframe=timeframe, ts=ts, open=o, high=h, low=lo, close=c,
        volume=v, buy_volume=bv, sell_volume=sv, provider=provider, synthetic=synthetic, meta=meta or {},
    )


def resample(frame: CandleFrame, timeframe: str) -> CandleFrame:
    """Aggregate a candle frame into a larger timeframe (bucket aligned to UTC)."""
    timeframe = normalize_timeframe(timeframe)
    if timeframe == frame.timeframe or len(frame) == 0:
        return frame
    step = TIMEFRAMES[timeframe]
    bucket = (frame.ts // step) * step
    # group boundaries
    change = np.flatnonzero(np.diff(bucket)) + 1
    starts = np.concatenate([[0], change])
    ends = np.concatenate([change, [len(frame)]])
    ts = bucket[starts]
    o = frame.open[starts]
    c = frame.close[ends - 1]
    h = np.maximum.reduceat(frame.high, starts)
    lo = np.minimum.reduceat(frame.low, starts)
    v = np.add.reduceat(frame.volume, starts)
    bv = sv = None
    if frame.buy_volume is not None:
        bv = np.add.reduceat(frame.buy_volume, starts)
        sv = np.add.reduceat(frame.sell_volume, starts)
    return CandleFrame(
        symbol=frame.symbol, timeframe=timeframe, ts=ts.astype(np.int64), open=o, high=h, low=lo,
        close=c, volume=v, buy_volume=bv, sell_volume=sv, provider=frame.provider,
        synthetic=frame.synthetic, meta=dict(frame.meta),
    )


def resample_trades(trades: list, step: int) -> list[dict]:
    """Aggregate raw trades into OHLCV+tick-delta bars (used by the CSV trade importer)."""
    if not trades:
        return []
    buckets: dict[int, dict] = {}
    for t in sorted(trades, key=lambda x: x.ts):
        b = int(t.ts // step) * step
        row = buckets.get(b)
        if row is None:
            buckets[b] = {
                "time": b, "open": t.price, "high": t.price, "low": t.price, "close": t.price,
                "volume": t.size, "d": (t.size if t.side > 0 else -t.size if t.side < 0 else 0),
            }
        else:
            row["high"] = max(row["high"], t.price)
            row["low"] = min(row["low"], t.price)
            row["close"] = t.price
            row["volume"] += t.size
            row["d"] += t.size if t.side > 0 else -t.size if t.side < 0 else 0
    out = []
    for row in buckets.values():
        d = row.pop("d")
        row["buy_volume"] = max(d, 0.0)
        row["sell_volume"] = max(-d, 0.0)
        out.append(row)
    return out


def et_label(ts: int | float) -> str:
    return to_et(int(ts)).strftime("%Y-%m-%d %H:%M")


def iso_local(ts: int | float) -> str:
    return to_et(int(ts)).isoformat()


def parse_et(text: str) -> int:
    """Parse '2026-11-16 09:30' (ET) into epoch seconds."""
    dt = datetime.fromisoformat(text.strip().replace("T", " "))
    return int(to_et(dt).timestamp())
