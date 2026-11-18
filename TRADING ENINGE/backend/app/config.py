"""Configuration loading with hot, persisted UI overrides.

YAML files in /config are the source of truth for defaults. The UI patches
risk, signal and strategy parameters at runtime; those patches are stored in
data/runtime_overrides.json so they survive a restart without rewriting YAML.
"""
from __future__ import annotations

import copy
import json
import threading
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[2]


def _deep_merge(base: dict, patch: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (patch or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


class Config:
    def __init__(self, root: Path | str = ROOT) -> None:
        self.root = Path(root)
        self.config_dir = self.root / "config"
        self.data_dir = self.root / "data"
        self.overrides_path = self.data_dir / "runtime_overrides.json"
        self._lock = threading.RLock()
        self._raw_settings: dict = {}
        self._raw_strategies: dict = {}
        self._raw_markets: dict = {}
        self.overrides: dict = {}
        self.reload()

    # ------------------------------------------------------------------ load
    def reload(self) -> None:
        with self._lock:
            self._raw_settings = yaml.safe_load(
                (self.config_dir / "settings.yaml").read_text(encoding="utf-8")
            ) or {}
            self._raw_strategies = (
                yaml.safe_load((self.config_dir / "strategies.yaml").read_text(encoding="utf-8")) or {}
            ).get("strategies", {})
            self._raw_markets = yaml.safe_load(
                (self.config_dir / "markets.yaml").read_text(encoding="utf-8")
            ) or {}
            self.overrides = {}
            if self.overrides_path.exists():
                try:
                    self.overrides = json.loads(self.overrides_path.read_text(encoding="utf-8"))
                except json.JSONDecodeError:
                    self.overrides = {}
            self.data_dir.mkdir(parents=True, exist_ok=True)

    def _save_overrides(self) -> None:
        self.overrides_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.overrides_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.overrides, indent=2), encoding="utf-8")
        tmp.replace(self.overrides_path)

    # --------------------------------------------------------------- sections
    def section(self, name: str) -> dict:
        with self._lock:
            base = copy.deepcopy(self._raw_settings.get(name, {}) or {})
            return _deep_merge(base, self.overrides.get(name, {}))

    @property
    def app(self) -> dict:
        return self.section("app")

    @property
    def data(self) -> dict:
        return self.section("data")

    @property
    def fundamentals(self) -> dict:
        return self.section("fundamentals")

    @property
    def risk(self) -> dict:
        return self.section("risk")

    @property
    def signals(self) -> dict:
        return self.section("signals")

    @property
    def backtest(self) -> dict:
        return self.section("backtest")

    @property
    def paper(self) -> dict:
        return self.section("paper")

    @property
    def journal(self) -> dict:
        return self.section("journal")

    @property
    def markets_yaml(self) -> dict:
        return self._raw_markets

    # -------------------------------------------------------------- strategies
    def strategies(self) -> dict:
        with self._lock:
            out: dict[str, dict] = {}
            over = self.overrides.get("strategies", {})
            for key, meta in self._raw_strategies.items():
                meta = copy.deepcopy(meta or {})
                o = over.get(key, {})
                if "enabled" in o:
                    meta["enabled"] = bool(o["enabled"])
                if "params" in o:
                    meta["params"] = _deep_merge(meta.get("params", {}), o["params"])
                out[key] = meta
            return out

    def strategy(self, name: str) -> dict:
        return self.strategies().get(name, {})

    def update_strategy(self, name: str, enabled: bool | None = None, params: dict | None = None) -> dict:
        with self._lock:
            if name not in self._raw_strategies:
                raise KeyError(f"unknown strategy '{name}'")
            slot = self.overrides.setdefault("strategies", {}).setdefault(name, {})
            if enabled is not None:
                slot["enabled"] = bool(enabled)
            if params:
                slot["params"] = _deep_merge(slot.get("params", {}), params)
            self._save_overrides()
            return self.strategy(name)

    # ------------------------------------------------------------- patchable
    def update_section(self, name: str, patch: dict) -> dict:
        if name not in {"risk", "signals", "backtest", "fundamentals", "paper"}:
            raise KeyError(f"section '{name}' is not runtime-editable")
        with self._lock:
            self.overrides[name] = _deep_merge(self.overrides.get(name, {}), patch)
            self._save_overrides()
            return self.section(name)

    def reset_overrides(self) -> None:
        with self._lock:
            self.overrides = {}
            self._save_overrides()

    # ---------------------------------------------------------------- helpers
    def path(self, relative: str) -> Path:
        p = Path(relative)
        return p if p.is_absolute() else (self.root / p).resolve()

    def snapshot(self) -> dict[str, Any]:
        return {
            "app": self.app,
            "data": self.data,
            "fundamentals": self.fundamentals,
            "risk": self.risk,
            "signals": self.signals,
            "backtest": self.backtest,
            "paper": self.paper,
            "strategies": self.strategies(),
            "markets": self._raw_markets.get("markets", []),
        }
