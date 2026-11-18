"""CSV import: NinjaTrader Historical Data Manager exports + generic OHLCV.

Free real intraday data path for NinjaTrader users:
  Control Center -> Tools -> Historical Data Manager -> Export -> .txt/.csv
then drop the file into data/csv/ and select provider: csv.

Supported layouts
-----------------
NinjaTrader (semicolon, no header):
    20260116 093000;20450.25;20451.50;20448.00;20450.75;1234
Generic (header required, any of , ; \\t |):
    time,open,high,low,close,volume
Trades (header, aggregated into bars with buy/sell volume):
    time,price,size,side
"""
from __future__ import annotations

import csv as _csv
import io
import re
from datetime import datetime
from pathlib import Path

import numpy as np

from ..instruments import Instrument
from ..session import ET
from .base import Capabilities, DataAdapter, DataError, Trade
from .frame import CandleFrame, make_frame, normalize_timeframe, resample

_DATE_FORMATS = (
    "%Y%m%d %H%M%S", "%Y%m%d %H%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M",
    "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d", "%m/%d/%Y %H:%M:%S", "%m/%d/%Y %H:%M",
    "%m/%d/%Y %H:%M:%S.%f", "%d/%m/%Y %H:%M",
)
_HEADER_ALIASES = {
    "time": {"time", "timestamp", "date_time", "datetime", "ts"},
    "date": {"date", "day"},
    "open": {"open", "o"},
    "high": {"high", "h"},
    "low": {"low", "l"},
    "close": {"close", "c", "last"},
    "volume": {"volume", "vol", "v", "size"},
    "buy_volume": {"buy_volume", "buyvolume", "bid_volume", "up_volume"},
    "sell_volume": {"sell_volume", "sellvolume", "ask_volume", "down_volume"},
    "price": {"price", "trade_price"},
    "side": {"side", "aggressor", "direction"},
}
_TF_HINTS = {"1m": 60, "5m": 300, "15m": 900, "30m": 1800, "60m": 3600, "1h": 3600, "4h": 14400, "1d": 86400}


def _parse_ts(raw: str, tz: str = "America/New_York") -> int:
    raw = raw.strip().replace("T", " ").replace("Z", "")
    for fmt in _DATE_FORMATS:
        try:
            dt = datetime.strptime(raw, fmt)
            return int(dt.replace(tzinfo=ET).timestamp())
        except ValueError:
            continue
    # last resort: dateutil-style ISO
    try:
        dt = datetime.fromisoformat(raw)
        return int((dt if dt.tzinfo else dt.replace(tzinfo=ET)).timestamp())
    except ValueError as exc:
        raise DataError(f"unrecognised timestamp '{raw}'") from exc


def _to_float(raw: str) -> float:
    return float(str(raw).replace(",", "").replace(" ", "") or 0)


def _detect_delimiter(line: str) -> str:
    counts = {d: line.count(d) for d in (";", ",", "\t", "|")}
    best = max(counts, key=counts.get)
    return best if counts[best] else ","


def parse_csv_text(text: str, default_timeframe: str = "1m") -> tuple[list[dict], list[Trade] | None, dict]:
    text = text.lstrip("\ufeff\r\n")
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if not lines:
        raise DataError("empty CSV file")
    delim = _detect_delimiter(lines[0])
    has_header = bool(re.search(r"[A-Za-z]{3,}", lines[0].replace("T", " ")))
    meta = {"delimiter": delim, "header": has_header, "rows": len(lines), "format": "generic"}

    if not has_header:
        # NinjaTrader positional: date time open high low close volume [oi]
        rows, trades = [], None
        meta["format"] = "ninjatrader"
        for ln in lines:
            parts = [p.strip() for p in ln.split(delim)]
            if len(parts) < 6:
                continue
            ts_raw = " ".join(parts[:2]) if len(parts[0]) <= 10 and " " not in parts[0] else parts[0]
            o, h, l, c, v = (_to_float(x) for x in parts[2:7])
            if h < l or o <= 0:
                continue
            rows.append({"time": _parse_ts(ts_raw), "open": o, "high": h, "low": l, "close": c,
                         "volume": v if len(parts) > 6 else 0.0})
        return rows, trades, meta

    reader = _csv.DictReader(io.StringIO("\n".join(lines)), delimiter=delim)
    fields = {(f or "").strip().lower(): f for f in (reader.fieldnames or [])}
    colmap: dict[str, str] = {}
    for canonical, aliases in _HEADER_ALIASES.items():
        for name, original in fields.items():
            if name in aliases or name.replace(" ", "_") in aliases:
                colmap[canonical] = original
                break
    if "price" in colmap and "close" not in colmap:
        meta["format"] = "trades"
        trades = []
        for row in reader:
            ts = _parse_ts(str(row[colmap.get("time") or colmap.get("date")]))
            price = _to_float(row[colmap["price"]])
            size = _to_float(row.get(colmap.get("volume", ""), 1) or 1) if colmap.get("volume") else 1.0
            side_raw = str(row.get(colmap["side"], "")).lower() if colmap.get("side") else ""
            side = 1 if side_raw in {"b", "buy", "bid", "1"} else -1 if side_raw in {"s", "sell", "ask", "-1"} else 0
            trades.append(Trade(ts=float(ts), price=price, size=size, side=side,
                                aggressor={1: "buy", -1: "sell", 0: "unknown"}[side]))
        return [], trades, meta

    missing = [c for c in ("time", "open", "high", "low", "close") if c not in colmap and not (c == "time" and "date" in colmap)]
    if missing:
        raise DataError(f"CSV is missing required columns: {', '.join(missing)}")
    rows = []
    for row in reader:
        time_key = colmap.get("time") or colmap.get("date")
        ts = _parse_ts(str(row[time_key]))
        entry = {
            "time": ts,
            "open": _to_float(row[colmap["open"]]), "high": _to_float(row[colmap["high"]]),
            "low": _to_float(row[colmap["low"]]), "close": _to_float(row[colmap["close"]]),
            "volume": _to_float(row[colmap["volume"]]) if colmap.get("volume") else 0.0,
        }
        if colmap.get("buy_volume") and colmap.get("sell_volume"):
            entry["buy_volume"] = _to_float(row[colmap["buy_volume"]])
            entry["sell_volume"] = _to_float(row[colmap["sell_volume"]])
        rows.append(entry)
    return rows, None, meta


class CsvFeed(DataAdapter):
    provider_id = "csv"

    def __init__(self, config: dict, instruments: dict[str, Instrument]) -> None:
        self.dir = Path(config.get("csv_dir", "./data/csv"))
        self.instruments = instruments
        self.default_tf = "1m"
        self.capabilities = Capabilities(
            candles=True, trades=False, depth=False, live=False, delayed=False,
            synthetic=False, historical=True, provider="csv",
            notes=("Local CSV import. Depth-dependent features stay disabled.",),
        )
        self._cache: dict[str, tuple[float, CandleFrame, list[Trade] | None, dict]] = {}

    # --------------------------------------------------------------- discovery
    def files(self) -> list[dict]:
        if not self.dir.exists():
            return []
        out = []
        for p in sorted(self.dir.iterdir()):
            if p.suffix.lower() not in {".csv", ".txt", ".tsv"}:
                continue
            stem = p.stem.upper()
            symbol = next((s for s in self.instruments if s in stem), None)
            if not symbol:
                continue
            out.append({"file": p.name, "symbol": symbol, "size_bytes": p.stat().st_size,
                        "modified": datetime.fromtimestamp(p.stat().st_mtime).isoformat(timespec="seconds")})
        return out

    def file_for(self, symbol: str) -> Path | None:
        if not self.dir.exists():
            return None
        candidates = []
        for p in self.dir.iterdir():
            if p.suffix.lower() not in {".csv", ".txt", ".tsv"}:
                continue
            if symbol.upper() in p.stem.upper():
                # prefer trade files second; candle files first
                rank = 0 if "TRADE" not in p.stem.upper() else 1
                candidates.append((rank, p.stat().st_mtime, p))
        if not candidates:
            return None
        candidates.sort(key=lambda x: (x[0], -x[1]))
        return candidates[0][2]

    def _load(self, symbol: str) -> tuple[CandleFrame, list[Trade] | None, dict]:
        path = self.file_for(symbol)
        if path is None:
            raise DataError(
                f"no CSV found for {symbol} in {self.dir}. Export from NinjaTrader "
                "(Tools > Historical Data Manager > Export) and name it e.g. MNQ_1m.csv"
            )
        mtime = path.stat().st_mtime
        cached = self._cache.get(symbol)
        if cached and cached[0] == mtime:
            return cached[1], cached[2], cached[3]
        rows, trades, meta = parse_csv_text(path.read_text(encoding="utf-8", errors="replace"))
        meta["file"] = path.name
        if trades:
            from .frame import resample_trades
            rows = resample_trades(trades, 60)
            meta["aggregated_trades"] = len(trades)
        if not rows:
            raise DataError(f"{path.name} contained no usable rows")
        # infer timeframe from median spacing if the filename has no hint
        tf = next((k for k, v in _TF_HINTS.items() if f"_{k}" in path.stem.lower()), None)
        deltas = np.diff(np.array([r["time"] for r in rows]))
        inferred = int(np.median(deltas)) if len(deltas) else 60
        tf = tf or next((k for k, v in _TF_HINTS.items() if v == inferred), "1m")
        frame = make_frame(symbol, tf if tf != "60m" else "1h", rows, provider="csv",
                           synthetic=False, meta=meta)
        if trades:
            self.capabilities = Capabilities(
                candles=True, trades=True, depth=False, live=False, delayed=False,
                synthetic=False, historical=True, provider="csv_trades",
                notes=("Local trade prints imported from CSV (no depth).",),
            )
        self._cache[symbol] = (mtime, frame, trades, meta)
        return frame, trades, meta

    # ------------------------------------------------------------------ data
    def get_candles(self, symbol: str, timeframe: str, limit: int | None = None) -> CandleFrame:
        timeframe = normalize_timeframe(timeframe)
        frame, _, _ = self._load(symbol)
        from .frame import TIMEFRAMES
        if TIMEFRAMES[timeframe] >= TIMEFRAMES[frame.timeframe]:
            out = resample(frame, timeframe)
        else:
            out = frame  # cannot invent finer bars than the file provides
        if limit and len(out) > limit:
            out = CandleFrame(
                symbol=out.symbol, timeframe=out.timeframe, ts=out.ts[-limit:], open=out.open[-limit:],
                high=out.high[-limit:], low=out.low[-limit:], close=out.close[-limit:],
                volume=out.volume[-limit:],
                buy_volume=None if out.buy_volume is None else out.buy_volume[-limit:],
                sell_volume=None if out.sell_volume is None else out.sell_volume[-limit:],
                provider=out.provider, synthetic=False,
                meta={**out.meta, "truncated": True},
            )
        return out

    def get_trades(self, symbol: str, start: float, end: float) -> list[Trade]:
        _, trades, _ = self._load(symbol)
        if not trades:
            raise DataError(f"{symbol}: the imported CSV has no trade prints (bars only)")
        return [t for t in trades if start <= t.ts <= end]

    def available_symbols(self) -> list[str]:
        return [s for s in self.instruments if self.file_for(s) is not None]

    def health(self) -> dict:
        files = self.files()
        return {
            "provider": "csv", "ok": bool(files),
            "capabilities": self.capabilities.dict(),
            "detail": f"{len(files)} file(s) in {self.dir}" if files else f"No CSV files found in {self.dir}",
            "files": files,
        }
