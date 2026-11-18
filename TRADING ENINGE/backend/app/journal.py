"""Trade journal + weekly review.

Every signal is logged. The user marks whether they took it and enters their own
fills; outcomes are computed in R and dollars. Rule breaks are detected by
comparing the journal entry against the plan that produced the signal.
"""
from __future__ import annotations

import time
from datetime import datetime, timedelta

from .db import Database
from .session import ET


class JournalService:
    def __init__(self, db: Database, cfg) -> None:
        self.db = db
        self.cfg = cfg

    # ---------------------------------------------------------------- signals
    def log_signal(self, card: dict, source: str = "live") -> str:
        return self.db.save_signal(card, source=source)

    def recent_signals(self, symbol: str | None = None, timeframe: str | None = None,
                       limit: int = 50) -> list[dict]:
        return self.db.list_signals(limit=limit, symbol=symbol, timeframe=timeframe)

    # ---------------------------------------------------------------- entries
    def create_entry(self, payload: dict) -> dict:
        card = payload.get("signal") or payload.get("card") or {}
        signal_id = payload.get("signal_id") or card.get("id")
        if signal_id and not card:
            stored = [s for s in self.db.list_signals(limit=200) if s["id"] == signal_id]
            card = stored[0]["payload"] if stored else {}
        entry = {
            "signal_id": signal_id,
            "symbol": payload.get("symbol") or card.get("symbol"),
            "timeframe": payload.get("timeframe") or card.get("timeframe"),
            "strategy": payload.get("strategy") or card.get("strategy"),
            "direction": payload.get("direction") or card.get("direction"),
            "entry": payload.get("entry") or (card.get("entry") or {}).get("price"),
            "stop": payload.get("stop") or (card.get("stop") or {}).get("price"),
            "target": payload.get("target") or ((card.get("targets") or [{}])[0].get("price")),
            "size": payload.get("size") or (card.get("size") or {}).get("contracts") or 0,
            "risk_dollars": (card.get("size") or {}).get("risk_dollars"),
            "reward_dollars": (card.get("size") or {}).get("reward_dollars"),
            "rr": (card.get("size") or {}).get("rr"),
            "score": payload.get("score") or card.get("score"),
            "taken": int(bool(payload.get("taken", True))),
            "fill_price": payload.get("fill_price"),
            "exit_price": payload.get("exit_price"),
            "outcome_r": payload.get("outcome_r"),
            "outcome_dollars": payload.get("outcome_dollars"),
            "notes": payload.get("notes", ""),
            "screenshot": payload.get("screenshot"),
            "tags": payload.get("tags") or [],
            "entry_ts": payload.get("entry_ts") or card.get("created_ts"),
            "exit_ts": payload.get("exit_ts"),
        }
        entry["rules_broken"] = self.rule_breaks(entry, card)
        if entry["outcome_r"] is None and entry.get("fill_price") and entry.get("exit_price"):
            entry["outcome_r"], entry["outcome_dollars"] = self._compute_outcome(entry)
        return {"id": self.db.save_journal(entry), **entry}

    def update_entry(self, jid: str, patch: dict) -> dict | None:
        existing = self.db.get_journal(jid)
        if not existing:
            return None
        merged = {**existing, **patch}
        if merged.get("fill_price") and merged.get("exit_price"):
            r, dollars = self._compute_outcome(merged)
            patch = {**patch, "outcome_r": round(r, 3), "outcome_dollars": round(dollars, 2)}
        return self.db.update_journal(jid, patch)

    def list_entries(self, limit: int = 100, symbol: str | None = None,
                     days: int | None = None) -> list[dict]:
        since = int((datetime.now(ET) - timedelta(days=days)).timestamp()) if days else None
        return self.db.list_journal(limit=limit, symbol=symbol, since=since)

    # ------------------------------------------------------------------ maths
    def _compute_outcome(self, entry: dict) -> tuple[float, float]:
        from .instruments import InstrumentBook

        # dollars per point comes from the spec table; fall back to the stored card
        symbol = entry.get("symbol")
        spec = None
        try:
            book = InstrumentBook.from_yaml(self.cfg.markets_yaml)
            spec = book.get(symbol)
        except Exception:
            spec = None
        dpp = spec.dollars_per_point if spec else 1.0
        sign = 1 if entry.get("direction") == "long" else -1
        fill = float(entry["fill_price"])
        exit_ = float(entry["exit_price"])
        qty = int(entry.get("size") or 1)
        dollars = (exit_ - fill) * sign * dpp * qty
        risk = abs(fill - float(entry["stop"])) if entry.get("stop") else 0
        r = dollars / (risk * dpp * qty) if risk > 0 else 0.0
        return r, dollars

    def rule_breaks(self, entry: dict, card: dict) -> list[str]:
        breaks: list[str] = []
        if not card:
            return breaks
        plan_size = (card.get("size") or {}).get("contracts")
        if plan_size and entry.get("size") and int(entry["size"]) > int(plan_size):
            breaks.append(f"Size {entry['size']} exceeded the planned {plan_size} contracts")
        card_stop = (card.get("stop") or {}).get("price")
        if card_stop and entry.get("stop"):
            worse = (entry["direction"] == "long" and float(entry["stop"]) < float(card_stop)) or \
                    (entry["direction"] == "short" and float(entry["stop"]) > float(card_stop))
            if worse:
                breaks.append("Stop widened beyond the planned invalidation")
        threshold = float(self.cfg.signals.get("threshold", 60))
        if entry.get("score") is not None and float(entry["score"]) < threshold:
            breaks.append(f"Traded a setup scoring {entry['score']}, below the {threshold:.0f} threshold")
        if (card.get("fundamental") or {}).get("news_window"):
            breaks.append("Entered during a high-impact news window")
        if card.get("direction") and entry.get("direction") and card["direction"] != entry["direction"]:
            breaks.append("Direction taken opposite to the signal")
        if card.get("blocked"):
            breaks.append("Signal card had blocking checks: " + ", ".join(
                b.get("code", "") for b in card["blocked"]))
        return breaks

    # ----------------------------------------------------------------- review
    def weekly_review(self, days: int = 7, end: datetime | None = None) -> dict:
        end = end or datetime.now(ET)
        start = end - timedelta(days=days)
        entries = self.list_entries(limit=1000, days=days)
        taken = [e for e in entries if e.get("taken")]
        closed = [e for e in taken if e.get("outcome_r") is not None]
        total_r = sum(float(e["outcome_r"]) for e in closed)
        total_dollars = sum(float(e.get("outcome_dollars") or 0) for e in closed)
        wins = [e for e in closed if float(e["outcome_r"]) > 0]
        breaks: dict[str, int] = {}
        for e in entries:
            for b in (e.get("rules_broken") or []):
                breaks[b] = breaks.get(b, 0) + 1

        def group(key: str) -> list[dict]:
            buckets: dict[str, list[dict]] = {}
            for e in closed:
                buckets.setdefault(str(e.get(key) or "unknown"), []).append(e)
            rows = []
            for name, items in buckets.items():
                r = sum(float(x["outcome_r"]) for x in items)
                rows.append({
                    "name": name,
                    "trades": len(items),
                    "total_r": round(r, 2),
                    "avg_r": round(r / len(items), 2),
                    "dollars": round(sum(float(x.get("outcome_dollars") or 0) for x in items), 2),
                    "win_rate": round(100 * len([x for x in items if float(x["outcome_r"]) > 0]) / len(items), 1),
                    "rule_breaks": sum(len(x.get("rules_broken") or []) for x in items),
                })
            rows.sort(key=lambda x: -x["total_r"])
            return rows

        skipped = [e for e in entries if not e.get("taken")]
        return {
            "period": {"start": start.isoformat(timespec="minutes"), "end": end.isoformat(timespec="minutes"),
                       "days": days},
            "signals_logged": len(entries),
            "taken": len(taken),
            "skipped": len(skipped),
            "closed": len(closed),
            "open": len(taken) - len(closed),
            "total_r": round(total_r, 2),
            "total_dollars": round(total_dollars, 2),
            "win_rate": round(100 * len(wins) / len(closed), 1) if closed else None,
            "avg_r": round(total_r / len(closed), 2) if closed else None,
            "adherence_rate": round(100 * len([e for e in entries if not e.get("rules_broken")]) / len(entries), 1)
            if entries else None,
            "by_strategy": group("strategy"),
            "by_symbol": group("symbol"),
            "by_session": group("session"),
            "rule_breaks": [{"rule": k, "count": v} for k, v in sorted(breaks.items(), key=lambda kv: -kv[1])],
            "best_strategy": group("strategy")[0] if closed else None,
            "worst_strategy": group("strategy")[-1] if closed else None,
            "caveat": ("Small samples mislead. This review reflects only the trades you logged and "
                       "marked, not every signal the app produced."),
        }
