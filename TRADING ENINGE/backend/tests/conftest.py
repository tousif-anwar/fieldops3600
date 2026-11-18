import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Config
from app.data.service import MarketDataService
from app.fundamentals.service import FundamentalService
from app.instruments import InstrumentBook
from app.strategies import StrategyRegistry


@pytest.fixture(scope="session")
def cfg() -> Config:
    c = Config()
    # keep tests deterministic and independent of any runtime UI overrides
    c.overrides = {}
    return c


@pytest.fixture(scope="session")
def book(cfg) -> InstrumentBook:
    return InstrumentBook.from_yaml(cfg.markets_yaml)


@pytest.fixture(scope="session")
def svc(cfg, book) -> MarketDataService:
    return MarketDataService(cfg, book)


@pytest.fixture(scope="session")
def registry(cfg) -> StrategyRegistry:
    return StrategyRegistry(cfg)


@pytest.fixture(scope="session")
def funds(cfg) -> FundamentalService:
    return FundamentalService(cfg.fundamentals)


@pytest.fixture(scope="session")
def mnq_frame(svc):
    return svc.frame("MNQ", "5m")


@pytest.fixture(scope="session")
def mnq_inst(book):
    return book.get("MNQ")
