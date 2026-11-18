"""CME session logic in America/New_York (Globex vs RTH, trading dates, ORB)."""
from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")

GLOBEX_OPEN = time(18, 0)   # prior calendar day, ET
GLOBEX_CLOSE = time(17, 0)  # trading day, ET (daily maintenance 17:00-18:00)
OVERNIGHT_OPEN = time(18, 0)

# Exchange holidays on which Globex is closed or has a shortened session.
# Kept deliberately small and explicit rather than guessed.
HOLIDAYS_2026 = {
    date(2026, 1, 1), date(2026, 1, 19), date(2026, 2, 16), date(2026, 4, 3),
    date(2026, 5, 25), date(2026, 6, 19), date(2026, 7, 3), date(2026, 9, 7),
    date(2026, 11, 26), date(2026, 12, 25),
}
HOLIDAYS_2027 = {
    date(2027, 1, 1), date(2027, 1, 18), date(2027, 2, 15), date(2027, 3, 26),
    date(2027, 5, 31), date(2027, 6, 18), date(2027, 7, 5), date(2027, 9, 6),
    date(2027, 11, 25), date(2027, 12, 24),
}
HOLIDAYS = HOLIDAYS_2026 | HOLIDAYS_2027

# Half days: RTH closes at 13:00 ET (equity index).
HALF_DAYS = {date(2026, 11, 27), date(2026, 12, 24), date(2027, 11, 26)}


def to_et(ts: float | datetime) -> datetime:
    if isinstance(ts, datetime):
        return ts.astimezone(ET) if ts.tzinfo else ts.replace(tzinfo=ET)
    return datetime.fromtimestamp(ts, tz=ET)


def epoch(dt: datetime) -> float:
    return dt.timestamp()


def trading_date(ts: float | datetime) -> date:
    """CME trading date: anything from 18:00 ET belongs to the next calendar day."""
    dt = to_et(ts)
    d = dt.date()
    if dt.time() >= GLOBEX_OPEN:
        d = d + timedelta(days=1)
    return d


def is_tradable(ts: float | datetime) -> bool:
    dt = to_et(ts)
    wd, t = dt.weekday(), dt.time()
    if dt.date() in HOLIDAYS:
        return False
    if wd == 5:  # Saturday
        return False
    if wd == 6:  # Sunday: opens 18:00 ET
        return t >= GLOBEX_OPEN
    if GLOBEX_CLOSE <= t < GLOBEX_OPEN:  # daily maintenance break
        return False
    if wd == 4:  # Friday hard close 17:00
        return t < GLOBEX_CLOSE
    return True


@dataclass(frozen=True)
class SessionInfo:
    trading_date: str
    globex_open: float
    globex_close: float
    rth_open: float
    rth_close: float
    phase: str              # overnight | premarket | rth | post | closed
    is_rth: bool
    is_open: bool
    minutes_into_rth: float
    minutes_to_rth_close: float
    minutes_into_rth_or_zero: float

    def dict(self) -> dict:
        return asdict(self)


def _dt(d: date, hhmm: str) -> datetime:
    h, m = hhmm.split(":")
    return datetime.combine(d, time(int(h), int(m)), tzinfo=ET)


def rth_times(inst_sector: str = "equity_index", d: date | None = None) -> tuple[time, time]:
    from .instruments import SECTOR_RTH

    open_s, close_s = SECTOR_RTH.get(inst_sector, ("09:30", "16:00"))
    oh, om = open_s.split(":")
    ch, cm = close_s.split(":")
    close = time(int(ch), int(cm))
    if d is not None and d in HALF_DAYS:
        close = time(13, 0)
    return time(int(oh), int(om)), close


def session_bounds(ts: float | datetime, sector: str = "equity_index") -> SessionInfo:
    dt = to_et(ts)
    td = trading_date(dt)
    rth_open_t, rth_close_t = rth_times(sector, td)
    rth_open = epoch(datetime.combine(td, rth_open_t, tzinfo=ET))
    rth_close = epoch(datetime.combine(td, rth_close_t, tzinfo=ET))
    globex_open = epoch(datetime.combine(td - timedelta(days=1), GLOBEX_OPEN, tzinfo=ET))
    globex_close = epoch(datetime.combine(td, GLOBEX_CLOSE, tzinfo=ET))

    now = epoch(dt)
    if now < globex_open or now >= globex_close:
        phase = "closed"
    elif now < rth_open:
        phase = "overnight" if now < epoch(datetime.combine(td, time(8, 0), tzinfo=ET)) else "premarket"
    elif now < rth_close:
        phase = "rth"
    else:
        phase = "post"

    is_rth = phase == "rth"
    into_rth = max(0.0, (now - rth_open) / 60.0) if now >= rth_open else 0.0
    to_close = max(0.0, (rth_close - now) / 60.0)
    return SessionInfo(
        trading_date=td.isoformat(),
        globex_open=globex_open,
        globex_close=globex_close,
        rth_open=rth_open,
        rth_close=rth_close,
        phase=phase,
        is_rth=is_rth,
        is_open=is_tradable(dt),
        minutes_into_rth=round(into_rth, 1),
        minutes_to_rth_close=round(to_close, 1),
        minutes_into_rth_or_zero=round(into_rth, 1),
    )


def rth_window(td: date, sector: str = "equity_index") -> tuple[float, float]:
    o, c = rth_times(sector, td)
    return (
        epoch(datetime.combine(td, o, tzinfo=ET)),
        epoch(datetime.combine(td, c, tzinfo=ET)),
    )


def globex_window(td: date) -> tuple[float, float]:
    return (
        epoch(datetime.combine(td - timedelta(days=1), GLOBEX_OPEN, tzinfo=ET)),
        epoch(datetime.combine(td, GLOBEX_CLOSE, tzinfo=ET)),
    )


def opening_range_window(td: date, sector: str, minutes: int) -> tuple[float, float]:
    o, _ = rth_times(sector, td)
    start = datetime.combine(td, o, tzinfo=ET)
    return epoch(start), epoch(start + timedelta(minutes=minutes))


def minutes_between(a: float, b: float) -> float:
    return (b - a) / 60.0


def session_label(ts: float) -> str:
    """'RTH', 'ON' (overnight), 'PRE', 'POST' - used for per-session stats."""
    s = session_bounds(ts)
    return {"rth": "RTH", "overnight": "ON", "premarket": "PRE", "post": "POST", "closed": "CLOSED"}[s.phase]


def session_timing_score(ts: float, sector: str = "equity_index") -> tuple[float, str]:
    """0..1 quality of the moment for a new entry, plus a human reason.

    Best: first 2 hours of RTH and the closing hour. Worst: lunch chop and
    the illiquid overnight session. This is a *timing* factor only.
    """
    s = session_bounds(ts, sector)
    m = s.minutes_into_rth
    if not s.is_rth:
        if s.phase == "overnight":
            return 0.25, "overnight session, thin liquidity"
        if s.phase == "premarket":
            return 0.45, "pre-market, waiting for the cash open"
        return 0.2, f"{s.phase}, outside the regular session"
    if m <= 30:
        return 1.0, "opening drive window"
    if m <= 120:
        return 0.9, "morning trend window"
    if m <= 210:
        return 0.45, "midday chop window"
    if s.minutes_to_rth_close <= 60:
        return 0.85, "closing-hour window"
    return 0.7, "afternoon session"
