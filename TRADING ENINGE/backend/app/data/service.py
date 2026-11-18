"""Provider selection, caching and per-symbol capability resolution."""
from __future__ import annotations

import time
from threading import RLock

from ..config import Config
from ..instruments import InstrumentBook
from .base import Capabilities, DataAdapter, DataError, DepthEvent, DepthSnapshot, Trade
from .csv_feed import CsvFeed
from .frame import CandleFrame, normalize_timeframe
from .simulated import SimulatedFeed
from .stubs import STUBS
from .yahoo import YahooFeed

YAHOO_TTL = 45.0


class MarketDataService:
    def __init__(self, cfg: Config, book: InstrumentBook) -> None:
        self.cfg = cfg
        self.book = book
        self._lock = RLock()
        self._adapter: DataAdapter = SimulatedFeed({}, book.instruments)
        self.provider = "simulated"
        self._yahoo_cache: dict[tuple[str, str], tuple[float, CandleFrame]] = {}
        self._build()

    # ------------------------------------------------------------------ setup
    def _build(self) -> None:
        d = self.cfg.data
        provider = str(d.get("provider", "simulated")).lower()
        if provider == "csv":
            self._adapter = CsvFeed(d.get("csv", {}) or {}, self.book.instruments)
        elif provider == "yahoo":
            self._adapter = YahooFeed(d.get("yahoo", {}) or {})
        elif provider in STUBS:
            self._adapter = STUBS[provider]()
        else:
            provider = "simulated"
            self._adapter = SimulatedFeed(d, self.book.instruments)
        self.provider = provider
        self._yahoo_cache.clear()

    def reload(self) -> dict:
        with self._lock:
            self.cfg.reload()
            self._build()
            return self.describe()

    # ------------------------------------------------------------ capabilities
    def capabilities(self, symbol: str) -> Capabilities:
        if isinstance(self._adapter, CsvFeed):
            return self._adapter.capabilities_for(symbol.upper())
        return self._adapter.capabilities

    def available(self, symbol: str) -> bool:
        if isinstance(self._adapter, CsvFeed):
            return self._adapter.file_for(symbol.upper()) is not None
        return True

    def describe(self) -> dict:
        return {
            "provider": self.provider,
            "live": self._adapter.capabilities.live,
            "delayed": self._adapter.capabilities.delayed,
            "synthetic": self._adapter.capabilities.synthetic,
            "available_symbols": [s for s in self.book.symbols() if self.available(s)],
            "health": self._adapter.health(),
            "alternatives": {
                "simulated": "Seeded synthetic feed. No setup needed; used for the demo and tests.",
                "csv": "NinjaTrader Historical Data Manager export (.csv/.txt) placed in data/csv/.",
                "yahoo": "Free delayed Yahoo Finance via yfinance (pip install yfinance).",
                "databento": "Paid CME-native trades + MBO depth (stub until configured).",
                "tradovate": "Broker feed (stub until configured).",
                "rithmic": "Institutional gateway (stub until configured).",
                "cqg": "CQG WebAPI (stub until configured).",
            },
        }

    # ------------------------------------------------------------------ frames
    def frame(self, symbol: str, timeframe: str = "5m", limit: int | None = None) -> CandleFrame:
        symbol = symbol.upper()
        if not self.book.has(symbol):
            raise DataError(f"unknown market '{symbol}'")
        tf = normalize_timeframe(timeframe)
        with self._lock:
            if isinstance(self._adapter, YahooFeed):
                key = (symbol, tf)
                hit = self._yahoo_cache.get(key)
                if hit and time.time() - hit[0] < YAHOO_TTL and (limit is None or len(hit[1]) >= 1):
                    return hit[1] if limit is None else self._tail(hit[1], limit)
                frame = self._adapter.get_candles(symbol, tf, limit)
                frame.meta["fetched_at"] = time.time()
                self._yahoo_cache[key] = (time.time(), frame)
                return frame
            return self._adapter.get_candles(symbol, tf, limit)

    @staticmethod
    def _tail(frame: CandleFrame, limit: int) -> CandleFrame:
        if len(frame) <= limit:
            return frame
        return CandleFrame(
            symbol=frame.symbol, timeframe=frame.timeframe, ts=frame.ts[-limit:],
            open=frame.open[-limit:], high=frame.high[-limit:], low=frame.low[-limit:],
            close=frame.close[-limit:], volume=frame.volume[-limit:],
            buy_volume=None if frame.buy_volume is None else frame.buy_volume[-limit:],
            sell_volume=None if frame.sell_volume is None else frame.sell_volume[-limit:],
            provider=frame.provider, synthetic=frame.synthetic, meta=frame.meta,
        )

    # ------------------------------------------------------------------ extras
    def trades(self, symbol: str, start: float, end: float) -> list[Trade]:
        return self._adapter.get_trades(symbol.upper(), start, end)

    def depth_events(self, symbol: str, start: float, end: float) -> list[DepthEvent]:
        return self._adapter.get_depth_events(symbol.upper(), start, end)

    def depth_snapshot(self, symbol: str, ts: float | None = None) -> DepthSnapshot:
        return self._adapter.get_depth_snapshot(symbol.upper(), ts)

    def advance(self, symbol: str, timeframe: str = "1m") -> bool:
        with self._lock:
            try:
                frame = self._adapter.advance(symbol.upper(), timeframe)
            except Exception:
                return False
            return frame is not None

    def health(self) -> dict:
        return self._adapter.health()
