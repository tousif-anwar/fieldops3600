"""Position sizing must match a manual calculation, exactly."""
from __future__ import annotations

from datetime import date

import pytest

from app.instruments import InstrumentBook, front_month
from app.signals import risk as risk_mod


@pytest.fixture
def specs(book):
    return {s: book.get(s) for s in ("MNQ", "NQ", "MES", "ES")}


def test_contract_multipliers(specs):
    assert specs["MNQ"].dollars_per_point == 2.0
    assert specs["NQ"].dollars_per_point == 20.0
    assert specs["MES"].dollars_per_point == 5.0
    assert specs["ES"].dollars_per_point == 50.0
    assert specs["MNQ"].tick_size == 0.25


def test_tick_rounding(specs):
    mnq = specs["MNQ"]
    assert mnq.round_tick(20000.13) == 20000.25
    assert mnq.round_tick(20000.12) == 20000.0
    assert mnq.round_tick(20000.63) == 20000.75
    assert mnq.ticks(10.0) == 40
    assert round(mnq.tick_size * mnq.dollars_per_point, 2) == 0.50


def test_front_month_contract_code(book):
    code, expiry = front_month(book.get("MNQ"), date(2026, 11, 16))
    assert code == "MNQZ6", code
    assert expiry == date(2026, 12, 18)


def test_manual_size_calculation(specs):
    mnq = specs["MNQ"]
    cfg = {"account_size": 25000, "risk_mode": "dollars", "risk_per_trade": 150,
           "buying_power_per_trade": 9000, "max_contracts": 5}
    # stop 10 points -> 10 * 2 = 20 USD per contract -> 150/20 = 7 by risk,
    # buying power 9000/2400 = 3 -> binding = buying power
    out = risk_mod.size_position(mnq, 20000.0, 19990.0, cfg)
    assert out["per_contract_risk"] == 20.0
    assert out["max_by_risk"] == 7
    assert out["max_by_buying_power"] == 3
    assert out["contracts"] == 3
    assert out["binding"] == "buying_power"
    assert out["risk_dollars"] == 60.0
    assert out["margin_required"] == 7200.0


def test_risk_budget_binds_when_tighter(specs):
    mnq = specs["MNQ"]
    cfg = {"account_size": 25000, "risk_mode": "dollars", "risk_per_trade": 100,
           "buying_power_per_trade": 50000, "max_contracts": 10}
    out = risk_mod.size_position(mnq, 20000.0, 19960.0, cfg)
    # 40 points * $2 = $80 per contract -> floor(100/80) = 1
    assert out["contracts"] == 1
    assert out["binding"] == "risk"
    assert out["risk_dollars"] == 80.0


def test_max_contracts_cap(specs):
    es = specs["ES"]
    cfg = {"account_size": 1000000, "risk_mode": "dollars", "risk_per_trade": 20000,
           "buying_power_per_trade": 1000000, "max_contracts": 4}
    out = risk_mod.size_position(es, 5000.0, 4990.0, cfg)
    # 10 points * $50 = $500 per contract -> 40 by risk, but cap is 4
    assert out["max_by_risk"] == 40
    assert out["contracts"] == 4
    assert out["binding"] == "max_contracts"


def test_percent_risk_mode(specs):
    mnq = specs["MNQ"]
    cfg = {"account_size": 50000, "risk_mode": "percent", "risk_percent": 0.5,
           "buying_power_per_trade": 100000, "max_contracts": 10}
    budget, label = risk_mod.risk_budget(cfg)
    assert budget == 250.0
    assert "0.50%" in label
    out = risk_mod.size_position(mnq, 20000.0, 19990.0, cfg)
    assert out["max_by_risk"] == 12  # 250 / 20 = 12.5 -> 12


def test_margin_override(specs):
    mnq = specs["MNQ"]
    cfg = {"account_size": 25000, "risk_mode": "dollars", "risk_per_trade": 150,
           "buying_power_per_trade": 5000, "max_contracts": 5, "margins": {"MNQ": 1000}}
    out = risk_mod.size_position(mnq, 20000.0, 19990.0, cfg)
    assert out["margin"] == 1000.0
    assert out["max_by_buying_power"] == 5


def test_trade_math_matches_manual(specs):
    mnq = specs["MNQ"]
    out = risk_mod.trade_math(mnq, 20000.0, 19990.0, [20020.0, 20050.0, 20100.0], 2)
    assert out["risk_dollars"] == 40.0
    assert out["targets"][0]["reward_dollars"] == 80.0
    assert out["targets"][0]["rr"] == 2.0
    assert out["targets"][1]["rr"] == 5.0
    assert out["targets"][2]["rr"] == 10.0


def test_zero_size_when_stop_too_wide(specs):
    mnq = specs["MNQ"]
    cfg = {"account_size": 25000, "risk_mode": "dollars", "risk_per_trade": 50,
           "buying_power_per_trade": 9000, "max_contracts": 5}
    out = risk_mod.size_position(mnq, 20000.0, 19900.0, cfg)  # $200/contract vs $50
    assert out["contracts"] == 0
    assert out["binding"] == "risk"
