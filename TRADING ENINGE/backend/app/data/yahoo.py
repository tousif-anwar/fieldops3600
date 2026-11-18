"""Optional free/delayed Yahoo Finance adapter (yfinance).

Free but limited and delayed:
  * 1m bars: last ~7 days
  * 5m/15m/30m: last ~60 days
  * 1h: ~730 days, daily: years
  * no tick prints, no depth  -> order-flow/iceberg features stay disabled
Requires `pip install yfinance`. Disabled unless data.yahoo.enabled: true.
"""
from __future__ import annotations

from datetime import datetime

import numpy as np

from ..session import ET
from .base import Capabilities, DataAdapter, DataError
from .frame import CandleFrame, normalize_timeframe, resample

_INTERVAL = {"1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1h", "2h": "1h", "4h": "1h", "1d": "1d"}
_PERIOD = {"1m": "7d", "5m": "60d", "15m": "60d", "30m": "60d", "1h": "730d", "2h": "730d", "4h": "730d", "1d": "2y"}


class YahooFeed(DataAdapter):
    provider_id = "yahoo"

    def __init__(self, config: dict) -> None:
        self.enabled = bool(config.get("enabled", False))
        self.symbols: dict[str, str] = config.get("symbols", {}) or {}
        self.capabilities = Capabilities(
            candles=True, trades=False, depth=False, live=True, delayed=True,
            synthetic=False, historical=True, provider="yahoo",
            notes=(
                "Yahoo Finance free data: delayed and rate-limited; intraday history is short.",
                "Continuous front-month proxy symbols (e.g. NQ=F), not an exact CME contract.",
            ),
        )

    def _yf(self):
        try:
            import yfinance as yf  # type: ignore
        except ImportError as exc:
            raise DataError(
                "yfinance is not installed. Run: .venv/Scripts/pip install yfinance "
                "(or set data.provider back to simulated)"
            ) from exc
        return yf

    def get_candles(self, symbol: str, timeframe: str, limit: int | None = None) -> CandleFrame:
        if not self.enabled:
            raise DataError("data.yahoo.enabled is false in config/settings.yaml")
        tf = normalize_timeframe(timeframe)
        ticker = self.symbols.get(symbol.upper())
        if not ticker:
            raise DataError(f"no Yahoo symbol mapped for {symbol}; edit data.yahoo.symbols")
        yf = self._yf()
        interval, period = _INTERVAL[tf], _PERIOD[tf]
        try:
            df = yf.download(ticker, period=period, interval=interval, progress=False,
                             auto_adjust=False, threads=False)
        except Exception as exc:  # network / rate-limit / parse
            raise DataError(f"Yahoo download failed for {ticker}: {exc}") from exc
        if df is None or len(df) == 0:
            raise DataError(f"Yahoo returned no data for {ticker} ({interval}/{period})")
        if hasattr(df.columns, "nlevels") and df.columns.nlevels > 1:
            df.columns = df.columns.get_level_values(0)
        rows = []
        for ts, row in df.iterrows():
            dt = ts.to_pydatetime()
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=ET)
            try:
                rows.append({
                    "time": int(dt.timestamp()),
                    "open": float(row["Open"]), "high": float(row["High"]),
                    "low": float(row["Low"]), "close": float(row["Close"]),
                    "volume": float(row.get("Volume", 0) or 0),
                })
            except (KeyError, TypeError, ValueError):
                continue
        rows = [r for r in rows if np.isfinite([r["open"], r["high"], r["low"], r["close"]]).all()]
        frame = CandleFrame(
            symbol=symbol, timeframe=tf, ts=np.array([r["time"] for r in rows], dtype=np.int64),
            open=np.array([r["open"] for r in rows]), high=np.array([r["high"] for r in rows]),
            low=np.array([r["low"] for r in rows]), close=np.array([r["close"] for r in rows]),
            volume=np.array([r["volume"] for r in rows]), provider="yahoo",
            synthetic=False, meta={"ticker": ticker, "delayed": True},
        )
        if tf in {"2h", "4h"}:
            frame = resample(frame, tf)
        if limit and len(frame) > limit:
            frame = CandleFrame(
                symbol=frame.symbol, timeframe=frame.timeframe, ts=frame.ts[-limit:],
                open=frame.open[-limit:], high=frame.high[-limit:], low=frame.low[-limit:],
                close=frame.close[-limit:], volume=frame.volume[-limit:],
                provider="yahoo", synthetic=False, meta=frame.meta,
            )
        return frame

    def health(self) -> dict:
        return {
            "provider": "yahoo", "ok": self.enabled,
            "capabilities": self.capabilities.dict(),
            "detail": (
                "Delayed free data via yfinance." if self.enabled
                else "Disabled. Set data.yahoo.enabled=true and pip install yfinance."
            ),
            "mapped_symbols": self.symbols,
        }
