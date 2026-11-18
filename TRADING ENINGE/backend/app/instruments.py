"""Contract specifications, tick rounding, contract codes and roll logic."""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from functools import lru_cache

# CME month codes
MONTH_CODES = {
    1: "F", 2: "G", 3: "H", 4: "J", 5: "K", 6: "M",
    7: "N", 8: "Q", 9: "U", 10: "V", 11: "X", 12: "Z",
}

# Which contract months each product family lists actively.
ACTIVE_MONTHS = {
    "equity_index": [3, 6, 9, 12],
    "energy": list(range(1, 13)),
    "metals": [2, 4, 6, 8, 10, 12],
    "grains": [3, 5, 7, 9, 12],
}

SECTOR_RTH = {
    "equity_index": ("09:30", "16:00"),
    "energy": ("09:00", "14:30"),
    "metals": ("08:20", "13:30"),
    "grains": ("09:30", "14:20"),
}


@dataclass(frozen=True)
class Instrument:
    symbol: str
    name: str
    exchange: str
    root: str
    dollars_per_point: float
    tick_size: float
    margin: float
    sector: str = "equity_index"
    fundamentals: tuple[str, ...] = ()
    sim_start: float = 100.0
    sim_vol: float = 0.0005
    sim_drift: float = 0.0

    # ------------------------------------------------------------------ prices
    def round_tick(self, price: float) -> float:
        if not math.isfinite(price):
            return price
        ticks = round(price / self.tick_size)
        return round(ticks * self.tick_size, 10)

    def floor_tick(self, price: float) -> float:
        return round(math.floor(price / self.tick_size) * self.tick_size, 10)

    def ceil_tick(self, price: float) -> float:
        return round(math.ceil(price / self.tick_size) * self.tick_size, 10)

    def ticks(self, distance: float) -> int:
        return int(round(abs(distance) / self.tick_size))

    def points(self, ticks: int) -> float:
        return round(ticks * self.tick_size, 10)

    def dollars(self, points: float, contracts: int = 1) -> float:
        return round(points * self.dollars_per_point * contracts, 2)

    def decimals(self) -> int:
        if self.tick_size >= 1:
            return 0
        return max(0, int(round(-math.log10(self.tick_size))))

    def format_price(self, price: float) -> str:
        return f"{price:,.{self.decimals()}f}"

    def rth(self) -> tuple[str, str]:
        return SECTOR_RTH.get(self.sector, ("09:30", "16:00"))

    def active_months(self) -> list[int]:
        return ACTIVE_MONTHS.get(self.sector, list(range(1, 13)))

    def spec(self) -> dict:
        return {
            "symbol": self.symbol,
            "name": self.name,
            "exchange": self.exchange,
            "root": self.root,
            "dollars_per_point": self.dollars_per_point,
            "tick_size": self.tick_size,
            "tick_value": round(self.tick_size * self.dollars_per_point, 4),
            "margin": self.margin,
            "sector": self.sector,
            "fundamentals": list(self.fundamentals),
            "rth": list(self.rth()),
            "decimals": self.decimals(),
        }


@dataclass
class InstrumentBook:
    instruments: dict[str, Instrument] = field(default_factory=dict)

    def get(self, symbol: str) -> Instrument:
        inst = self.instruments.get(symbol.upper())
        if inst is None:
            raise KeyError(f"market '{symbol}' is not configured in config/markets.yaml")
        return inst

    def has(self, symbol: str) -> bool:
        return symbol.upper() in self.instruments

    def all(self) -> list[Instrument]:
        return list(self.instruments.values())

    def symbols(self) -> list[str]:
        return list(self.instruments.keys())

    @classmethod
    def from_yaml(cls, payload: dict) -> "InstrumentBook":
        book = cls()
        for row in payload.get("markets", []):
            sim = row.get("sim", {}) or {}
            inst = Instrument(
                symbol=row["symbol"].upper(),
                name=row.get("name", row["symbol"]),
                exchange=row.get("exchange", "CME"),
                root=row.get("root", row["symbol"]),
                dollars_per_point=float(row["dollars_per_point"]),
                tick_size=float(row.get("tick_size", 0.25)),
                margin=float(row.get("margin", 0)),
                sector=row.get("sector", "equity_index"),
                fundamentals=tuple(row.get("fundamentals", [])),
                sim_start=float(sim.get("start", 100.0)),
                sim_vol=float(sim.get("vol", 0.0005)),
                sim_drift=float(sim.get("drift", 0.0)),
            )
            book.instruments[inst.symbol] = inst
        if not book.instruments:
            raise ValueError("config/markets.yaml contains no markets")
        return book


# --------------------------------------------------------------------------
# Contract codes + roll
# --------------------------------------------------------------------------
def third_friday(year: int, month: int) -> date:
    d = date(year, month, 1)
    # weekday(): Mon=0 ... Fri=4
    first_friday = 1 + (4 - d.weekday()) % 7
    return date(year, month, first_friday + 14)


def contract_expiry(inst: Instrument, year: int, month: int) -> date:
    """Approximate last trade date per product family (good enough for roll codes)."""
    if inst.sector == "equity_index":
        return third_friday(year, month)
    if inst.sector == "energy":
        # CL: ~3 business days before the 25th of the month prior to delivery
        return date(year, month, 20)
    if inst.sector == "metals":
        return date(year, month, 27)
    if inst.sector == "grains":
        return date(year, month, 28)
    return date(year, month, 20)


def front_month(inst: Instrument, asof: date | None = None, roll_days: int = 8) -> tuple[str, date]:
    """Return (contract code e.g. 'MNQZ6', expiry date) for the front month.

    Rolls to the next active contract `roll_days` before expiry so signals never
    reference a contract that is about to stop trading.
    """
    asof = asof or datetime.now().date()
    months = inst.active_months()
    for year_offset in (0, 1, 2):
        year = asof.year + year_offset
        for month in months:
            exp = contract_expiry(inst, year, month)
            if exp - timedelta(days=roll_days) > asof:
                code = f"{inst.root}{MONTH_CODES[month]}{str(year)[-1]}"
                return code, exp
    # unreachable for sane configs, keeps type checkers happy
    month = months[0]
    return f"{inst.root}{MONTH_CODES[month]}9", contract_expiry(inst, asof.year + 9, month)


def contract_code(root: str, month: int, year: int) -> str:
    return f"{root}{MONTH_CODES[month]}{str(year)[-1]}"


def contract_label(inst: Instrument, asof: date | None = None) -> dict:
    code, exp = front_month(inst, asof)
    return {
        "code": code,
        "expiry": exp.isoformat(),
        "days_to_expiry": (exp - (asof or datetime.now().date())).days,
    }
