"""SQLite persistence: signals, journal, paper runs, backtests."""
from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL, timeframe TEXT, contract TEXT, strategy TEXT, direction TEXT,
  score INTEGER, ts INTEGER, expires_ts INTEGER, source TEXT DEFAULT 'live',
  outcome TEXT DEFAULT 'open', outcome_r REAL,
  payload TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signals_symbol_ts ON signals(symbol, timeframe, ts);

CREATE TABLE IF NOT EXISTS journal (
  id TEXT PRIMARY KEY,
  signal_id TEXT, symbol TEXT, timeframe TEXT, strategy TEXT, direction TEXT,
  entry REAL, stop REAL, target REAL, size INTEGER, risk_dollars REAL, reward_dollars REAL,
  rr REAL, score INTEGER, taken INTEGER DEFAULT 0,
  fill_price REAL, exit_price REAL, outcome_r REAL, outcome_dollars REAL,
  notes TEXT, screenshot TEXT, rules_broken TEXT, tags TEXT,
  entry_ts INTEGER, exit_ts INTEGER, created_at INTEGER, updated_at INTEGER,
  payload TEXT
);
CREATE INDEX IF NOT EXISTS idx_journal_symbol ON journal(symbol, entry_ts);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, kind TEXT, started_at INTEGER, stopped_at INTEGER,
  symbol TEXT, timeframe TEXT, payload TEXT
);

CREATE TABLE IF NOT EXISTS paper_signals (
  id TEXT PRIMARY KEY, run_id TEXT, signal_id TEXT, ts INTEGER,
  status TEXT, outcome_r REAL, payload TEXT
);

CREATE TABLE IF NOT EXISTS backtests (
  id TEXT PRIMARY KEY, ts INTEGER, symbol TEXT, timeframe TEXT, label TEXT,
  metrics TEXT, hash TEXT, payload TEXT
);
"""


class Database:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self.init_schema()

    # ------------------------------------------------------------------ core
    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.path), timeout=10, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        return conn

    def init_schema(self) -> None:
        with self._lock, self.connect() as conn:
            conn.executescript(SCHEMA)

    def _exec(self, sql: str, params: tuple = ()) -> None:
        with self._lock, self.connect() as conn:
            conn.execute(sql, params)
            conn.commit()

    # --------------------------------------------------------------- signals
    def save_signal(self, card: dict, source: str = "live") -> str:
        sid = card.get("id") or uuid.uuid4().hex[:12]
        with self._lock, self.connect() as conn:
            conn.execute(
                """INSERT OR REPLACE INTO signals
                   (id, symbol, timeframe, contract, strategy, direction, score, ts,
                    expires_ts, source, outcome, payload, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (sid, card.get("symbol"), card.get("timeframe"), card.get("contract"),
                 card.get("strategy"), card.get("direction"), card.get("score"),
                 card.get("created_ts"), card.get("expires_ts"), source,
                 card.get("outcome", "open"), json.dumps(card), int(time.time())),
            )
            conn.commit()
        return sid

    def list_signals(self, limit: int = 50, symbol: str | None = None,
                     timeframe: str | None = None) -> list[dict]:
        sql = "SELECT * FROM signals"
        where, params = [], []
        if symbol:
            where.append("symbol = ?")
            params.append(symbol.upper())
        if timeframe:
            where.append("timeframe = ?")
            params.append(timeframe)
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY ts DESC LIMIT ?"
        params.append(int(limit))
        with self._lock, self.connect() as conn:
            rows = conn.execute(sql, tuple(params)).fetchall()
        out = []
        for row in rows:
            item = dict(row)
            item["payload"] = json.loads(item["payload"]) if item["payload"] else None
            out.append(item)
        return out

    def update_signal_outcome(self, signal_id: str, outcome: str, outcome_r: float | None) -> None:
        self._exec("UPDATE signals SET outcome = ?, outcome_r = ? WHERE id = ?",
                   (outcome, outcome_r, signal_id))

    # --------------------------------------------------------------- journal
    def save_journal(self, entry: dict) -> str:
        jid = entry.get("id") or uuid.uuid4().hex[:12]
        now = int(time.time())
        with self._lock, self.connect() as conn:
            conn.execute(
                """INSERT OR REPLACE INTO journal
                   (id, signal_id, symbol, timeframe, strategy, direction, entry, stop, target,
                    size, risk_dollars, reward_dollars, rr, score, taken, fill_price, exit_price,
                    outcome_r, outcome_dollars, notes, screenshot, rules_broken, tags,
                    entry_ts, exit_ts, created_at, updated_at, payload)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (jid, entry.get("signal_id"), entry.get("symbol"), entry.get("timeframe"),
                 entry.get("strategy"), entry.get("direction"), entry.get("entry"), entry.get("stop"),
                 entry.get("target"), entry.get("size"), entry.get("risk_dollars"),
                 entry.get("reward_dollars"), entry.get("rr"), entry.get("score"),
                 int(entry.get("taken", 0)), entry.get("fill_price"), entry.get("exit_price"),
                 entry.get("outcome_r"), entry.get("outcome_dollars"), entry.get("notes"),
                 entry.get("screenshot"), json.dumps(entry.get("rules_broken") or []),
                 json.dumps(entry.get("tags") or []), entry.get("entry_ts"), entry.get("exit_ts"),
                 entry.get("created_at", now), now, json.dumps(entry)),
            )
            conn.commit()
        return jid

    def list_journal(self, limit: int = 100, symbol: str | None = None,
                     since: int | None = None) -> list[dict]:
        sql = "SELECT * FROM journal"
        where, params = [], []
        if symbol:
            where.append("symbol = ?")
            params.append(symbol.upper())
        if since:
            where.append("COALESCE(entry_ts, created_at) >= ?")
            params.append(int(since))
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY created_at DESC LIMIT ?"
        params.append(int(limit))
        with self._lock, self.connect() as conn:
            rows = conn.execute(sql, tuple(params)).fetchall()
        out = []
        for row in rows:
            item = dict(row)
            for key in ("rules_broken", "tags"):
                try:
                    item[key] = json.loads(item[key]) if item[key] else []
                except json.JSONDecodeError:
                    item[key] = []
            item.pop("payload", None)
            out.append(item)
        return out

    def get_journal(self, jid: str) -> dict | None:
        with self._lock, self.connect() as conn:
            row = conn.execute("SELECT * FROM journal WHERE id = ?", (jid,)).fetchone()
        return dict(row) if row else None

    def update_journal(self, jid: str, patch: dict) -> dict | None:
        allowed = {
            "taken", "fill_price", "exit_price", "outcome_r", "outcome_dollars", "notes",
            "screenshot", "rules_broken", "tags", "size", "stop", "target", "entry",
        }
        fields, params = [], []
        for key, value in patch.items():
            if key not in allowed:
                continue
            fields.append(f"{key} = ?")
            params.append(json.dumps(value) if key in {"rules_broken", "tags"} else value)
        if not fields:
            return self.get_journal(jid)
        fields.append("updated_at = ?")
        params.append(int(time.time()))
        params.append(jid)
        self._exec(f"UPDATE journal SET {', '.join(fields)} WHERE id = ?", tuple(params))
        return self.get_journal(jid)

    def delete_journal(self, jid: str) -> None:
        self._exec("DELETE FROM journal WHERE id = ?", (jid,))

    # ------------------------------------------------------------------ runs
    def save_run(self, run_id: str, kind: str, symbol: str, timeframe: str, payload: dict,
                 stopped_at: int | None = None) -> None:
        with self._lock, self.connect() as conn:
            conn.execute(
                """INSERT INTO runs (id, kind, started_at, stopped_at, symbol, timeframe, payload)
                   VALUES (?,?,?,?,?,?,?)
                   ON CONFLICT(id) DO UPDATE SET stopped_at=excluded.stopped_at, payload=excluded.payload""",
                (run_id, kind, int(time.time()), stopped_at, symbol, timeframe, json.dumps(payload)),
            )
            conn.commit()

    def save_paper_signal(self, run_id: str, signal_id: str, ts: int, payload: dict,
                          status: str = "pending", outcome_r: float | None = None) -> str:
        pid = uuid.uuid4().hex[:12]
        self._exec(
            """INSERT INTO paper_signals (id, run_id, signal_id, ts, status, outcome_r, payload)
               VALUES (?,?,?,?,?,?,?)""",
            (pid, run_id, signal_id, int(ts), status, outcome_r, json.dumps(payload)),
        )
        return pid

    def list_paper_signals(self, run_id: str, limit: int = 200) -> list[dict]:
        with self._lock, self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM paper_signals WHERE run_id = ? ORDER BY ts DESC LIMIT ?",
                (run_id, int(limit))).fetchall()
        out = []
        for row in rows:
            item = dict(row)
            item["payload"] = json.loads(item["payload"]) if item["payload"] else None
            out.append(item)
        return out

    def update_paper_signal(self, pid: str, status: str, outcome_r: float | None) -> None:
        self._exec("UPDATE paper_signals SET status = ?, outcome_r = ? WHERE id = ?",
                   (status, outcome_r, pid))

    # ------------------------------------------------------------- backtests
    def save_backtest(self, report: dict) -> str:
        bid = uuid.uuid4().hex[:12]
        self._exec(
            """INSERT INTO backtests (id, ts, symbol, timeframe, label, metrics, hash, payload)
               VALUES (?,?,?,?,?,?,?,?)""",
            (bid, int(time.time()), report.get("symbol"), report.get("timeframe"),
             report.get("label"), json.dumps(report.get("metrics")),
             report.get("reproducible_hash"), json.dumps(report)),
        )
        return bid

    def list_backtests(self, limit: int = 20) -> list[dict]:
        with self._lock, self.connect() as conn:
            rows = conn.execute(
                "SELECT id, ts, symbol, timeframe, label, metrics, hash FROM backtests ORDER BY ts DESC LIMIT ?",
                (int(limit),)).fetchall()
        out = []
        for row in rows:
            item = dict(row)
            item["metrics"] = json.loads(item["metrics"] or "{}")
            out.append(item)
        return out

    def stats(self) -> dict:
        with self._lock, self.connect() as conn:
            def count(table: str) -> int:
                return int(conn.execute(f"SELECT COUNT(*) AS n FROM {table}").fetchone()["n"])
            return {"signals": count("signals"), "journal": count("journal"),
                    "paper_signals": count("paper_signals"), "backtests": count("backtests"),
                    "path": str(self.path)}
