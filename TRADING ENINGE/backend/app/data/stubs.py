"""Documented stubs for commercial CME feeds.

These adapters intentionally do nothing but describe what they would need.
No credentials are shipped, no data is faked, and the app falls back to the
configured provider. Implement `get_candles` / `get_trades` / `get_depth_events`
against the vendor SDK to light up the corresponding features.
"""
from __future__ import annotations

from .base import Capabilities, DataAdapter, DataError


class _StubAdapter(DataAdapter):
    provider_id = "stub"
    vendor = "unknown"
    requirements: tuple[str, ...] = ()
    docs = ""

    def __init__(self) -> None:
        self.capabilities = Capabilities(
            candles=False, trades=False, depth=False, live=False, delayed=False,
            synthetic=False, historical=False, provider=self.provider_id,
            notes=(f"{self.vendor} adapter is a documented stub. Not configured.",),
        )

    def get_candles(self, symbol, timeframe, limit=None):
        raise DataError(
            f"{self.vendor} is not configured. Needs: {', '.join(self.requirements)}. "
            f"Docs: {self.docs}. Use provider 'simulated', 'csv' or 'yahoo' in the meantime."
        )

    def health(self) -> dict:
        return {
            "provider": self.provider_id, "ok": False,
            "capabilities": self.capabilities.dict(),
            "detail": f"Not configured. Requires {', '.join(self.requirements)}.",
            "docs": self.docs,
        }


class DatabentoAdapter(_StubAdapter):
    provider_id = "databento"
    vendor = "Databento"
    requirements = ("DATABENTO_API_KEY", "dataset subscription for GLBX.MDP3")
    docs = "https://databento.com/docs"


class RithmicAdapter(_StubAdapter):
    provider_id = "rithmic"
    vendor = "Rithmic R|API+"
    requirements = ("Rithmic credentials", "R|API+ gateway binary", "market-data entitlement")
    docs = "https://www.rithmic.com/"


class CqgAdapter(_StubAdapter):
    provider_id = "cqg"
    vendor = "CQG WebAPI"
    requirements = ("CQG username/password", "WebAPI licence", "exchange data entitlement")
    docs = "https://www.cqg.com/products/cqg-webapi"


class TradovateAdapter(_StubAdapter):
    provider_id = "tradovate"
    vendor = "Tradovate"
    requirements = ("Tradovate account", "API access via the Tradovate API demo/prod endpoint")
    docs = "https://api.tradovate.com/"


STUBS = {
    "databento": DatabentoAdapter,
    "rithmic": RithmicAdapter,
    "cqg": CqgAdapter,
    "tradovate": TradovateAdapter,
}
