"""Deterministic simulated CME feed.

Produces:
  * 1-minute candles for a configurable number of past Globex sessions, with
    realistic session gaps, an intraday volatility smile and event spikes
  * resampled intraday timeframes from those 1m bars (consistent by design)
  * a separate synthetic daily series long enough for daily backtests
  * (optional) synthetic tick prints and L2 depth events so the order-flow and
    iceberg features can be demonstrated end to end

Everything is seeded per symbol, so a restart reproduces the same history.
All output is marked synthetic=True and the UI warns about it.
"""
from __future__ import annotations

import math
import zlib
from datetime import datetime, timedelta

import numpy as np

from ..instruments import Instrument
from ..session import ET, HOLIDAYS, session_bounds, trading_date
from .base import Capabilities, DataAdapter, DepthEvent, DepthSnapshot, Trade
from .frame import CandleFrame, normalize_timeframe, resample

_SESSION_START_MIN = 18 * 60        # 18:00 ET previous day
_SESSION_END_MIN = 17 * 60          # 17:00 ET trading day
_EVENT_MINUTES = {510, 600, 840, 900, 960}  # 08:30, 10:00, 14:00, 15:00, 16:00


def _seed_for(symbol: str, salt: str = "") -> int:
    return zlib.crc32(f"{symbol}|{salt}".encode()) & 0xFFFFFFFF


def _intraday_shape(n: int, minutes: np.ndarray) -> np.ndarray:
    """Volatility smile: hot open, quiet lunch, active close, event spikes."""
    shape = 1.0 + 1.15 * np.exp(-minutes / 45.0) + 0.55 * np.exp(-(1380 - minutes) / 55.0)
    shape += 0.35 * np.exp(-((minutes - 660) ** 2) / (2 * 70.0 ** 2))
    for m in _EVENT_MINUTES:
        shape += 0.6 * np.exp(-((minutes - m) ** 2) / (2 * 6.0 ** 2))
    return shape


class SimulatedFeed(DataAdapter):
    provider_id = "simulated"

    def __init__(self, config: dict, instruments: dict[str, Instrument]) -> None:
        sim = (config.get("simulated") or {})
        self.include_trades = bool(sim.get("include_trades", True))
        self.include_depth = bool(sim.get("include_depth", True))
        self.trades_per_bar = int(sim.get("trades_per_bar", 60))
        self.sessions = int(config.get("history_sessions", 40))
        self.instruments = instruments
        # adapter capabilities reflect the widest market; per-symbol merge in service
        self.capabilities = Capabilities(
            candles=True, trades=self.include_trades, depth=self.include_depth,
            live=True, delayed=False, synthetic=True, historical=True, provider="simulated",
            notes=(
                "Synthetic prices from a seeded random process, not market data.",
                "Tick prints and depth are fabricated to exercise order-flow features.",
            ),
        )
        self._cache_1m: dict[str, CandleFrame] = {}
        self._cache_daily: dict[str, CandleFrame] = {}

    # --------------------------------------------------------------- candles
    def get_candles(self, symbol: str, timeframe: str, limit: int | None = None) -> CandleFrame:
        timeframe = normalize_timeframe(timeframe)
        inst = self.instruments[symbol]
        if timeframe == "1d":
            base = self._daily(inst)
        else:
            base = self._one_minute(inst)
            base = resample(base, timeframe) if timeframe != "1m" else base
        if limit:
            base = base.upto(len(base))
            if len(base) > limit:
                return CandleFrame(
                    symbol=base.symbol, timeframe=base.timeframe, ts=base.ts[-limit:],
                    open=base.open[-limit:], high=base.high[-limit:], low=base.low[-limit:],
                    close=base.close[-limit:], volume=base.volume[-limit:],
                    buy_volume=None if base.buy_volume is None else base.buy_volume[-limit:],
                    sell_volume=None if base.sell_volume is None else base.sell_volume[-limit:],
                    provider=self.provider_id, synthetic=True,
                    meta={**base.meta, "truncated": True},
                )
        return base

    # ------------------------------------------------------------ generation
    def _session_minutes(self, anchor: datetime, back_sessions: int) -> list[tuple[datetime, datetime, np.ndarray]]:
        """Past Globex sessions as (trading_date, session_start, minute offsets).

        A CME trading date Mon-Fri spans 18:00 the prior evening to 17:00, i.e.
        1380 one-minute slots. Only the in-progress session is truncated, so the
        feed can never emit a bar timestamped in the future.
        Early-close holidays are skipped by trading date.
        """
        sessions: list = []
        probe = trading_date(anchor)
        while len(sessions) < back_sessions:
            if probe.weekday() < 5 and probe not in HOLIDAYS:
                sessions.append(probe)
            probe -= timedelta(days=1)
        sessions.reverse()
        all_offsets = np.arange(0, 1380, dtype=np.float64)
        now = int(anchor.timestamp())
        out = []
        for sess in sessions:
            day0 = sess - timedelta(days=1)
            # the session opens at 18:00 the previous evening - filtering against
            # midnight would let an in-progress session emit future bars
            start = datetime(day0.year, day0.month, day0.day, 18, 0, tzinfo=ET)
            ts = int(start.timestamp()) + all_offsets * 60
            keep = ts < now
            if keep.any():
                out.append((sess, start, all_offsets[keep]))
        return out

    def _one_minute(self, inst: Instrument) -> CandleFrame:
        cached = self._cache_1m.get(inst.symbol)
        if cached is not None:
            return cached
        anchor = datetime.now(ET)
        sessions = self._session_minutes(anchor, self.sessions)
        rng = np.random.default_rng(_seed_for(inst.symbol, "1m"))
        rows: list[dict] = []
        last_close = inst.sim_start
        # Each session is scaled to a realistic daily move with a weak pull back to
        # the anchor, so 40 sessions stay in a believable price range.
        daily_target = inst.sim_vol * 24.0
        for sess_date, start, offsets in sessions:
            n = len(offsets)
            vol_shape = _intraday_shape(n, offsets)
            noise = rng.normal(0.0, 1.0, n)
            shock = np.zeros(n)
            acc = 0.0
            for j in range(n):
                acc = 0.62 * acc + noise[j]
                shock[j] = acc
            path = np.cumsum(shock * vol_shape)
            path -= np.linspace(0.0, path[-1], n)
            scale = float(np.std(path)) or 1.0
            path *= daily_target / scale
            net = rng.normal(0.0, daily_target) - 0.10 * math.log(max(last_close, 1e-9) / inst.sim_start)
            path += np.linspace(0.0, net, n)
            prices = last_close * np.exp(path)
            rets = np.diff(path, prepend=0.0)
            bar_scale = daily_target / math.sqrt(max(n, 1))
            op = np.concatenate([[last_close], prices[:-1]])
            cl = prices
            rng_hi = np.abs(rng.normal(0, inst.sim_vol * 0.55, n)) * cl
            rng_lo = np.abs(rng.normal(0, inst.sim_vol * 0.55, n)) * cl
            hi = np.maximum(op, cl) + rng_hi
            lo = np.minimum(op, cl) - rng_lo
            tick = inst.tick_size
            op = np.round(op / tick) * tick
            cl = np.round(cl / tick) * tick
            hi = np.round(hi / tick) * tick
            lo = np.round(lo / tick) * tick
            hi = np.maximum.reduce([hi, op, cl])
            lo = np.minimum.reduce([lo, op, cl])
            base_vol = 260.0 * (1 + 0.6 * (inst.symbol in {"NQ", "ES", "MNQ", "MES"}))
            vol_units = (0.6 + 1.4 * np.minimum(np.abs(rets) / max(bar_scale, 1e-12), 5.0)) * vol_shape
            volumes = np.round(base_vol * vol_units * rng.uniform(0.6, 1.4, n))
            volumes = np.maximum(volumes, 1.0)

            # convert minute offsets to epochs (18:00 ET session open + offset)
            for j in range(n):
                dt = start + timedelta(minutes=float(offsets[j]))
                rows.append({
                    "time": int(dt.timestamp()), "open": float(op[j]), "high": float(hi[j]),
                    "low": float(lo[j]), "close": float(cl[j]), "volume": float(volumes[j]),
                })
            last_close = float(cl[-1])

        frame = CandleFrame(
            symbol=inst.symbol, timeframe="1m",
            ts=np.array([r["time"] for r in rows], dtype=np.int64),
            open=np.array([r["open"] for r in rows]),
            high=np.array([r["high"] for r in rows]),
            low=np.array([r["low"] for r in rows]),
            close=np.array([r["close"] for r in rows]),
            volume=np.array([r["volume"] for r in rows]),
            provider=self.provider_id, synthetic=True,
            meta={"sessions": len(sessions), "seed": _seed_for(inst.symbol, "1m"),
                  "note": "Simulated 1m bars; intraday timeframes are resampled from these."},
        )
        self._cache_1m[inst.symbol] = frame
        return frame

    def _daily(self, inst: Instrument) -> CandleFrame:
        cached = self._cache_daily.get(inst.symbol)
        if cached is not None:
            return cached
        rng = np.random.default_rng(_seed_for(inst.symbol, "1d"))
        n = 900
        daily_vol = inst.sim_vol * 25.0
        rets = rng.normal(inst.sim_drift * 20.0, daily_vol, n)
        # regime blocks again, at daily scale
        block = 0
        while block < n:
            size = int(rng.integers(25, 90))
            kind = rng.choice(["bull", "bear", "chop"], p=[0.42, 0.30, 0.28])
            drift = {"bull": daily_vol * 0.22, "bear": -daily_vol * 0.22, "chop": 0.0}[kind]
            rets[block:block + size] += drift
            block += size
        close = inst.sim_start * 0.72 * np.exp(np.cumsum(rets))
        # rescale so the last daily close lines up with what the intraday sim implies
        intraday = self._one_minute(inst)
        target = float(intraday.close[-1]) if len(intraday) else inst.sim_start
        close = close * (target / close[-1])
        op = np.concatenate([[close[0] * (1 - daily_vol)], close[:-1]])
        hi = np.maximum(op, close) * (1 + np.abs(rng.normal(0, daily_vol * 0.5, n)))
        lo = np.minimum(op, close) * (1 - np.abs(rng.normal(0, daily_vol * 0.5, n)))
        tick = inst.tick_size
        op, cl, hi, lo = (np.round(x / tick) * tick for x in (op, close, hi, lo))
        hi = np.maximum.reduce([hi, op, cl]); lo = np.minimum.reduce([lo, op, cl])
        vol = np.round(9_000_000 / max(inst.sim_start, 1) * rng.uniform(0.5, 1.6, n))
        end = datetime.now(ET).replace(hour=16, minute=0, second=0, microsecond=0)
        if end > datetime.now(ET):
            # a session that closes at 16:00 is only complete after 16:00
            end -= timedelta(days=1)
        days = []
        d = end
        while len(days) < n:
            if d.weekday() < 5:
                days.append(d)
            d -= timedelta(days=1)
        days.reverse()
        frame = CandleFrame(
            symbol=inst.symbol, timeframe="1d",
            ts=np.array([int(x.timestamp()) for x in days], dtype=np.int64),
            open=op, high=hi, low=lo, close=cl, volume=vol,
            provider=self.provider_id, synthetic=True,
            meta={"sessions": n, "seed": _seed_for(inst.symbol, "1d"),
                  "note": "Simulated daily bars (independent of the 1m series)."},
        )
        self._cache_daily[inst.symbol] = frame
        return frame

    # ---------------------------------------------------------------- trades
    def get_trades(self, symbol: str, start: float, end: float) -> list[Trade]:
        if not self.include_trades:
            raise RuntimeError("simulated trades are disabled in settings (data.simulated.include_trades)")
        inst = self.instruments[symbol]
        frame = self._one_minute(inst)
        lo = frame.last_index_at(start)
        hi = frame.last_index_at(end)
        trades: list[Trade] = []
        for i in range(max(0, lo), min(len(frame), hi + 1)):
            trades.extend(self._bar_trades(inst, frame, i))
        return trades

    def _bar_trades(self, inst: Instrument, frame: CandleFrame, i: int) -> list[Trade]:
        rng = np.random.default_rng(_seed_for(inst.symbol, f"tr{i}:{int(frame.ts[i])}"))
        n = int(max(6, min(self.trades_per_bar, frame.volume[i] / 12)))
        o, h, l, c = float(frame.open[i]), float(frame.high[i]), float(frame.low[i]), float(frame.close[i])
        ts0 = int(frame.ts[i])
        # path from open to close with noise, clipped inside the bar range
        path = np.linspace(o, c, n) + rng.normal(0, max((h - l) / 9, inst.tick_size), n)
        path = np.clip(path, l, h)
        bullish = c >= o
        sides = np.where(rng.random(n) < (0.58 if bullish else 0.42), 1, -1)
        # the first and last prints tend to be in the direction of the close
        sizes = np.maximum(1, np.round(frame.volume[i] / n * rng.uniform(0.4, 1.8, n)))
        out = []
        for j in range(n):
            price = inst.round_tick(float(path[j]))
            ts = ts0 + (j / n) * 60
            out.append(Trade(ts=ts, price=price, size=float(sizes[j]), side=int(sides[j]),
                             aggressor="buy" if sides[j] > 0 else "sell"))
        return out

    # ----------------------------------------------------------------- depth
    def get_depth_events(self, symbol: str, start: float, end: float) -> list[DepthEvent]:
        if not self.include_depth:
            raise RuntimeError("simulated depth is disabled in settings (data.simulated.include_depth)")
        inst = self.instruments[symbol]
        frame = self._one_minute(inst)
        lo = max(0, frame.last_index_at(start))
        hi = min(len(frame), frame.last_index_at(end) + 1)
        events: list[DepthEvent] = []
        for i in range(lo, hi):
            rng = np.random.default_rng(_seed_for(inst.symbol, f"dp{i}:{int(frame.ts[i])}"))
            # Icebergs cluster around the bar's most-traded prices ~25% of bars
            if rng.random() < 0.25:
                anchor = float(frame.low[i] + (frame.high[i] - frame.low[i]) * rng.choice([0.15, 0.5, 0.85]))
                for k in range(int(rng.integers(1, 3))):
                    price = inst.round_tick(anchor + k * inst.tick_size * rng.choice([-1, 1]))
                    displayed = float(rng.integers(3, 18))
                    refreshes = int(rng.integers(2, 9))
                    filled = displayed * refreshes * float(rng.uniform(0.7, 1.4))
                    events.append(DepthEvent(
                        ts=float(frame.ts[i] + rng.uniform(0, 59)), price=price,
                        side="bid" if price < frame.close[i] else "ask",
                        displayed=displayed, filled=round(filled, 1), refreshes=refreshes,
                    ))
        return events

    def get_depth_snapshot(self, symbol: str, ts: float | None = None) -> DepthSnapshot:
        inst = self.instruments[symbol]
        frame = self._one_minute(inst)
        i = frame.last_index_at(ts if ts is not None else float(frame.ts[-1]))
        i = max(0, min(i, len(frame) - 1))
        rng = np.random.default_rng(_seed_for(inst.symbol, f"snap{int(frame.ts[i])}"))
        mid = inst.round_tick(float(frame.close[i]))
        bids = tuple((inst.round_tick(mid - inst.tick_size * (k + 1)), float(rng.integers(2, 60))) for k in range(10))
        asks = tuple((inst.round_tick(mid + inst.tick_size * (k + 1)), float(rng.integers(2, 60))) for k in range(10))
        return DepthSnapshot(ts=float(frame.ts[i]), bids=bids, asks=asks)

    # ------------------------------------------------------------------ live
    def advance(self, symbol: str, timeframe: str) -> CandleFrame | None:
        """Append the next 1m bar when the wall clock moved past it."""
        inst = self.instruments[symbol]
        base = self._one_minute(inst)
        now = datetime.now(ET).replace(second=0, microsecond=0)
        next_ts = int(base.ts[-1]) + 60
        # step over the 17:00-18:00 ET maintenance break and weekends: the feed
        # must never invent a bar for a minute the venue is closed
        for _ in range(4 * 24 * 60):
            if session_bounds(next_ts, inst.sector).phase != "closed":
                break
            next_ts += 60
        if next_ts > now.timestamp():
            return None
        rng = np.random.default_rng(_seed_for(inst.symbol, f"live{next_ts}"))
        last_close = float(base.close[-1])
        ret = rng.normal(0, inst.sim_vol * 1.1)
        close = inst.round_tick(last_close * math.exp(ret))
        open_ = last_close
        hi = inst.round_tick(max(open_, close) + abs(rng.normal(0, inst.sim_vol * 0.5)) * close)
        lo = inst.round_tick(min(open_, close) - abs(rng.normal(0, inst.sim_vol * 0.5)) * close)
        vol = float(max(1, round(300 * rng.uniform(0.5, 1.8))))
        new = CandleFrame(
            symbol=symbol, timeframe="1m",
            ts=np.append(base.ts, np.int64(next_ts)), open=np.append(base.open, open_),
            high=np.append(base.high, hi), low=np.append(base.low, lo),
            close=np.append(base.close, close), volume=np.append(base.volume, vol),
            provider=self.provider_id, synthetic=True, meta=base.meta,
        )
        self._cache_1m[symbol] = new
        return resample(new, timeframe) if timeframe != "1m" else new

    def health(self) -> dict:
        return {
            "provider": self.provider_id, "ok": True,
            "capabilities": self.capabilities.dict(),
            "detail": "Seeded synthetic feed. Reproducible per symbol; no network required.",
        }
