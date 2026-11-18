"""The synthetic feed must never emit a bar in the future.

A bar timestamped ahead of the wall clock would be a look-ahead leak even though
the analysis engine itself is causal: the data would contain bars that have not
happened yet. This test pins both the intraday and the daily series.
"""
from __future__ import annotations

from datetime import datetime

import pytest

from app.config import Config
from app.data.service import MarketDataService
from app.instruments import InstrumentBook
from app.session import ET


@pytest.fixture(scope="module")
def service() -> MarketDataService:
    cfg = Config()
    cfg.overrides = {}
    book = InstrumentBook.from_yaml(cfg.markets_yaml)
    return MarketDataService(cfg, book)


@pytest.mark.parametrize("timeframe", ["1m", "5m", "15m", "1h"])
def test_intraday_feed_has_no_future_bars(service: MarketDataService, timeframe: str) -> None:
    frame = service.frame("MNQ", timeframe)
    now = int(datetime.now(ET).timestamp()) + 1
    assert len(frame) > 100
    assert int(frame.ts[-1]) <= now, "last bar is timestamped in the future"
    assert bool((frame.ts <= now).all()), "at least one bar is timestamped in the future"


def test_daily_feed_has_no_future_bars(service: MarketDataService) -> None:
    frame = service.frame("MNQ", "1d")
    now = int(datetime.now(ET).timestamp()) + 1
    assert int(frame.ts[-1]) <= now
    last = datetime.fromtimestamp(int(frame.ts[-1]), ET)
    assert last.hour == 16, "daily bars are stamped at the 16:00 ET session close"


def test_in_progress_session_is_truncated(service: MarketDataService) -> None:
    """The final session must stop at the wall clock, not at 17:00."""
    frame = service.frame("MNQ", "1m")
    now = datetime.now(ET)
    last = datetime.fromtimestamp(int(frame.ts[-1]), ET)
    assert (now - last).total_seconds() < 24 * 3600
    # bars are one minute apart inside a session
    gaps = frame.ts[1:] - frame.ts[:-1]
    assert int(gaps.min()) == 60
