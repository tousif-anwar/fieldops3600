"""Cross-asset context: VIX, 10-year yield, dollar index, megacap earnings.

Simulated by default. `fundamentals.index_context: yahoo` uses free delayed
quotes for ^VIX, ^TNX and DX-Y.NYB when yfinance is installed and reachable.
"""
from __future__ import annotations

import math
import zlib
from datetime import date, timedelta

import numpy as np

EARNINGS_NAMES = ("NVDA", "MSFT", "AAPL", "AMZN", "GOOGL", "META")


def _wave(day_ordinal: int, seed: int, base: float, amp: float, spread: float) -> float:
    rng = np.random.default_rng((day_ordinal * 7919 + seed) & 0xFFFFFFFF)
    cycle = math.sin(day_ordinal / spread) * amp
    cycle += math.sin(day_ordinal / (spread * 0.37) + 1.3) * amp * 0.45
    return base + cycle + float(rng.normal(0, amp * 0.15))


def _series(model, day: date, seed: int, back: int = 6) -> list[float]:
    return [_wave(day.toordinal() - k, seed, *model) for k in range(back - 1, -1, -1)]


VIX = (17.5, 4.5, 9.0)
YIELD = (4.15, 0.35, 14.0)
DXY = (101.0, 2.0, 20.0)


def _trend(series: list[float]) -> tuple[str, float]:
    if len(series) < 2:
        return "flat", 0.0
    delta = series[-1] - series[0]
    scale = max(abs(np.mean(series)) * 0.02, 1e-6)
    norm = delta / scale
    if norm > 0.5:
        return "rising", float(norm)
    if norm < -0.5:
        return "falling", float(norm)
    return "flat", float(norm)


def earnings_window(day: date) -> list[dict]:
    """Megacap earnings clustered in mid-Jan/Apr/Jul/Oct (approximation, labelled)."""
    out = []
    for month in (1, 4, 7, 10):
        for k, name in enumerate(EARNINGS_NAMES):
            d = date(day.year, month, 18 + k * 2)
            delta = (d - day).days
            if -3 <= delta <= 10:
                out.append({"name": name, "date": d.isoformat(), "days_away": delta,
                            "note": "mega-cap index weight event"})
    return out


class IndexContext:
    def __init__(self, config: dict) -> None:
        cfg = config or {}
        self.mode = cfg.get("index_context", "simulated")
        self._cache: dict[str, tuple[float, dict]] = {}

    def snapshot(self, ts: float, sector: str) -> dict:
        from ..session import to_et

        day = to_et(ts).date()
        key = f"{day.isoformat()}|{sector}"
        if key in self._cache:
            return self._cache[key][1]
        if self.mode == "yahoo":
            snap = self._from_yahoo(ts)
            if snap is not None:
                snap["earnings"] = earnings_window(day) if sector == "equity_index" else []
                self._cache[key] = (ts, snap)
                return snap
        snap = self._simulated(day, sector)
        self._cache[key] = (ts, snap)
        return snap

    def _simulated(self, day: date, sector: str) -> dict:
        vix_series = _series(VIX, day, zlib.crc32(b"vix"))
        y_series = _series(YIELD, day, zlib.crc32(b"yield"))
        d_series = _series(DXY, day, zlib.crc32(b"dxy"))
        vix_trend, vix_slope = _trend(vix_series)
        y_trend, y_slope = _trend(y_series)
        d_trend, d_slope = _trend(d_series)
        return {
            "provider": "simulated",
            "vix": {"value": round(vix_series[-1], 2), "trend": vix_trend,
                    "change": round(vix_series[-1] - vix_series[-2], 2) if len(vix_series) > 1 else 0.0,
                    "series": [round(v, 2) for v in vix_series]},
            "yield_10y": {"value": round(y_series[-1], 3), "trend": y_trend,
                          "change": round(y_series[-1] - y_series[-2], 3) if len(y_series) > 1 else 0.0,
                          "series": [round(v, 3) for v in y_series]},
            "dxy": {"value": round(d_series[-1], 2), "trend": d_trend,
                    "change": round(d_series[-1] - d_series[-2], 2) if len(d_series) > 1 else 0.0,
                    "series": [round(v, 2) for v in d_series]},
            "sectors": self._sectors(day),
            "earnings": earnings_window(day) if sector == "equity_index" else [],
            "commodity": self._commodity(day, sector),
            "note": "Simulated cross-asset context. Replace it with data.fundamentals.index_context: yahoo.",
        }

    def _sectors(self, day: date) -> list[dict]:
        names = ["Technology", "Semiconductors", "Financials", "Energy", "Industrials", "Utilities"]
        out = []
        for k, n in enumerate(names):
            rng = np.random.default_rng((day.toordinal() * 31 + k) & 0xFFFFFFFF)
            chg = float(rng.normal(0.05, 0.9))
            out.append({"name": n, "change_pct": round(chg, 2),
                        "leader": bool(chg == max(-9.9, chg)) and chg > 0.8})
        return out

    def _commodity(self, day: date, sector: str) -> dict | None:
        if sector == "energy":
            rng = np.random.default_rng((day.toordinal() * 17) & 0xFFFFFFFF)
            return {"inventory_change_mbbl": round(float(rng.normal(1.2, 3.0)), 1),
                    "source": "simulated EIA weekly", "day": "Wednesday 10:30 ET"}
        if sector == "grains":
            rng = np.random.default_rng((day.toordinal() * 19) & 0xFFFFFFFF)
            return {"wasde_bias": str(rng.choice(["neutral", "tighter", "looser"])),
                    "source": "simulated WASDE", "day": "monthly ~12th 12:00 ET"}
        return None

    def _from_yahoo(self, ts: float) -> dict | None:
        try:
            import yfinance as yf  # type: ignore
        except ImportError:
            return None
        try:
            out = {"provider": "yahoo", "note": "Yahoo Finance delayed quotes."}
            for key, ticker in (("vix", "^VIX"), ("yield_10y", "^TNX"), ("dxy", "DX-Y.NYB")):
                df = yf.download(ticker, period="10d", interval="1d", progress=False, threads=False)
                if df is None or len(df) == 0:
                    return None
                if hasattr(df.columns, "nlevels") and df.columns.nlevels > 1:
                    df.columns = df.columns.get_level_values(0)
                vals = [float(v) for v in df["Close"].dropna().tolist()][-6:]
                trend, _ = _trend(vals)
                out[key] = {"value": round(vals[-1], 3), "trend": trend,
                            "change": round(vals[-1] - vals[-2], 3) if len(vals) > 1 else 0.0,
                            "series": [round(v, 3) for v in vals]}
            out["sectors"] = self._sectors(date.today())
            out["earnings"] = earnings_window(date.today())
            out["commodity"] = None
            return out
        except Exception:
            return None

    def source_label(self) -> str:
        return "yahoo (delayed)" if self.mode == "yahoo" else "simulated"
