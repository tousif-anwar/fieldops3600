"""Economic calendar with CME-relevant releases.

Default source is a deterministic simulated calendar (labelled as such). Drop a
CSV at data/csv/economic_calendar.csv with columns
    timestamp,name,impact,category,forecast,prior,actual
to use real numbers; the app never invents an `actual` it does not have.
"""
from __future__ import annotations

import calendar as _cal
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from pathlib import Path

import numpy as np

from ..session import ET, epoch


@dataclass(frozen=True)
class EconomicEvent:
    ts: float
    name: str
    impact: str          # high | medium | low
    category: str
    forecast: str = ""
    prior: str = ""
    actual: str = ""
    source: str = "simulated"
    affects: tuple[str, ...] = ("equity_index",)

    def dict(self) -> dict:
        return {
            "ts": int(self.ts),
            "time_et": datetime.fromtimestamp(self.ts, ET).strftime("%a %H:%M"),
            "date_et": datetime.fromtimestamp(self.ts, ET).strftime("%Y-%m-%d"),
            "name": self.name, "impact": self.impact, "category": self.category,
            "forecast": self.forecast, "prior": self.prior, "actual": self.actual,
            "source": self.source, "affects": list(self.affects),
        }


def _at(d: date, hh: int, mm: int = 0) -> float:
    return epoch(datetime.combine(d, time(hh, mm), tzinfo=ET))


def _nth_weekday(d: date, weekday: int, n: int) -> date:
    first = d.replace(day=1)
    offset = (weekday - first.weekday()) % 7
    return first + timedelta(days=offset + 7 * (n - 1))


def _last_weekday(d: date, weekday: int) -> date:
    last = d.replace(day=_cal.monthrange(d.year, d.month)[1])
    return last - timedelta(days=(last.weekday() - weekday) % 7)


def simulated_month(year: int, month: int) -> list[EconomicEvent]:
    """Deterministic recurring releases for one month."""
    out: list[EconomicEvent] = []
    first = date(year, month, 1)
    # weekly jobless claims (every Thursday)
    d = first
    while d.month == month:
        if d.weekday() == 3:
            out.append(EconomicEvent(_at(d, 8, 30), "Initial jobless claims", "low", "labor",
                                     source="simulated", affects=("equity_index",)))
        d += timedelta(days=1)
    # NFP: first Friday
    nfp = _nth_weekday(first, 4, 1)
    out.append(EconomicEvent(_at(nfp, 8, 30), "Non-farm payrolls", "high", "labor",
                             forecast="170k", prior="158k"))
    # CPI: second Wednesday
    cpi = _nth_weekday(first, 2, 2)
    out.append(EconomicEvent(_at(cpi, 8, 30), "CPI (core m/m)", "high", "inflation",
                             forecast="0.3%", prior="0.3%"))
    out.append(EconomicEvent(_at(cpi + timedelta(days=1), 8, 30), "PPI (m/m)", "medium", "inflation"))
    # retail sales: third Tuesday
    rs = _nth_weekday(first, 1, 3)
    out.append(EconomicEvent(_at(rs, 8, 30), "Retail sales (m/m)", "medium", "growth"))
    # PCE: last Friday
    pce = _last_weekday(first, 4)
    out.append(EconomicEvent(_at(pce, 8, 30), "Core PCE (m/m)", "medium", "inflation"))
    # GDP: last Thursday
    gdp = _last_weekday(first, 3)
    out.append(EconomicEvent(_at(gdp, 8, 30), "GDP (annualised q/q)", "medium", "growth"))
    # FOMC: Mar/Jun/Sep/Dec, second Wednesday 14:00
    if month in (3, 6, 9, 12):
        fomc = _nth_weekday(first, 2, 2)
        out.append(EconomicEvent(_at(fomc, 14, 0), "FOMC rate decision", "high", "policy",
                                 forecast="hold", prior="hold"))
    # ISM: first business day 10:00
    ism = first
    while ism.weekday() >= 5:
        ism += timedelta(days=1)
    out.append(EconomicEvent(_at(ism, 10, 0), "ISM manufacturing", "medium", "growth"))
    # EIA crude inventories: Wednesday 10:30
    eia = _nth_weekday(first, 2, 2)
    out.append(EconomicEvent(_at(eia, 10, 30), "EIA crude oil inventories", "medium", "energy",
                             affects=("energy",)))
    # USDA WASDE: ~12th at 12:00
    wasde = date(year, month, min(12, _cal.monthrange(year, month)[1]))
    out.append(EconomicEvent(_at(wasde, 12, 0), "USDA WASDE", "high", "agriculture",
                             affects=("grains",)))
    out.append(EconomicEvent(_at(date(year, month, min(15, _cal.monthrange(year, month)[1])), 9, 0),
                             "OPEC monthly report", "medium", "energy", affects=("energy",)))
    out.sort(key=lambda e: e.ts)
    return out


class EconomicCalendar:
    def __init__(self, config: dict) -> None:
        self.mode = (config or {}).get("calendar", "simulated")
        self.csv_path = Path((config or {}).get("calendar_csv", "./data/csv/economic_calendar.csv"))
        self._months: dict[tuple[int, int], list[EconomicEvent]] = {}
        self._csv: list[EconomicEvent] | None = None
        self.window_minutes = int((config or {}).get("news_window_minutes", 15))

    # ------------------------------------------------------------------ data
    def _load_csv(self) -> list[EconomicEvent]:
        if self._csv is not None:
            return self._csv
        events: list[EconomicEvent] = []
        if self.mode == "csv" and self.csv_path.exists():
            from ..data.csv_feed import _parse_ts

            lines = [ln for ln in self.csv_path.read_text(encoding="utf-8", errors="replace").splitlines() if ln.strip()]
            if lines:
                delim = ";" if ";" in lines[0] else ","
                header = [h.strip().lower() for h in lines[0].split(delim)]
                idx = {h: i for i, h in enumerate(header)}
                for ln in lines[1:]:
                    parts = [p.strip() for p in ln.split(delim)]
                    if len(parts) < 2:
                        continue
                    try:
                        ts = _parse_ts(parts[idx.get("timestamp", 0)])
                    except Exception:
                        continue
                    events.append(EconomicEvent(
                        ts=ts, name=parts[idx.get("name", 1)],
                        impact=parts[idx.get("impact", 2)].lower() if "impact" in idx else "medium",
                        category=parts[idx.get("category", 3)] if "category" in idx else "macro",
                        forecast=parts[idx["forecast"]] if "forecast" in idx else "",
                        prior=parts[idx["prior"]] if "prior" in idx else "",
                        actual=parts[idx["actual"]] if "actual" in idx else "",
                        source="csv",
                    ))
        self._csv = events
        return events

    def month(self, year: int, month: int) -> list[EconomicEvent]:
        if self.mode == "csv":
            rows = self._load_csv()
            return [e for e in rows
                    if datetime.fromtimestamp(e.ts, ET).year == year
                    and datetime.fromtimestamp(e.ts, ET).month == month]
        key = (year, month)
        if key not in self._months:
            self._months[key] = simulated_month(year, month)
        return self._months[key]

    def between(self, start_ts: float, end_ts: float) -> list[EconomicEvent]:
        out: list[EconomicEvent] = []
        d = datetime.fromtimestamp(start_ts, ET).date()
        end_d = datetime.fromtimestamp(end_ts, ET).date()
        seen = set()
        while d <= end_d:
            for e in self.month(d.year, d.month):
                if start_ts <= e.ts <= end_ts and (e.ts, e.name) not in seen:
                    seen.add((e.ts, e.name))
                    out.append(e)
            if d.month == 12:
                d = date(d.year + 1, 1, 1)
            else:
                d = date(d.year, d.month + 1, 1)
        return sorted(out, key=lambda e: e.ts)

    # ---------------------------------------------------------------- window
    def window_state(self, ts: float, sector: str) -> dict:
        """Is `ts` inside a no-trade style window around a high-impact release?"""
        day = datetime.fromtimestamp(ts, ET).date()
        events = [e for e in self.month(day.year, day.month)
                  if (sector in e.affects or "equity_index" == sector and sector in e.affects)]
        before = int(self.window_minutes) * 60
        after = int(self.window_minutes) * 60
        for e in events:
            if e.ts - before <= ts <= e.ts + after:
                minutes = (ts - e.ts) / 60.0
                if e.impact == "high":
                    return {
                        "active": True, "impact": e.impact, "event": e.dict(),
                        "minutes": round(minutes, 1),
                        "reason": (f"{e.name} window ({'in ' + str(abs(int(minutes))) + ' min' if minutes < 0 else 'released ' + str(int(minutes)) + ' min ago'})"),
                    }
                if e.impact == "medium" and abs(minutes) <= self.window_minutes:
                    return {"active": True, "impact": e.impact, "event": e.dict(),
                            "minutes": round(minutes, 1),
                            "reason": f"{e.name} release window, size reduced"}
        upcoming = [e for e in events if e.ts >= ts][:1]
        return {
            "active": False, "impact": None, "event": upcoming[0].dict() if upcoming else None,
            "minutes": round((upcoming[0].ts - ts) / 60.0, 1) if upcoming else None,
            "reason": "outside release windows",
        }

    def upcoming(self, ts: float, sector: str, count: int = 6) -> list[dict]:
        start = ts - 6 * 3600
        end = ts + 3 * 86400
        rows = [e for e in self.between(start, end) if sector in e.affects]
        rows.sort(key=lambda e: abs(e.ts - ts))
        return [e.dict() for e in rows[:count]]

    def source_label(self) -> str:
        return "economic_calendar.csv" if self.mode == "csv" else "simulated calendar"
