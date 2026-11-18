"""Headline feed with a simple, transparent sentiment tag.

Default source is simulated (deterministic templates). Point
fundamentals.news_csv at a CSV with `timestamp,headline,source` to score real
headlines with the same lexicon.
"""
from __future__ import annotations

import zlib
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np

from ..session import ET

POSITIVE = {
    "beats": 0.6, "beat": 0.6, "surge": 0.8, "rally": 0.7, "record high": 0.8,
    "upgrade": 0.6, "strong": 0.5, "growth": 0.4, "soft landing": 0.7, "cooler": 0.5,
    "dovish": 0.6, "cuts rates": 0.7, "stimulus": 0.6, "rebound": 0.5, "optimism": 0.5,
}
NEGATIVE = {
    "misses": -0.6, "miss": -0.6, "plunge": -0.8, "selloff": -0.7, "slump": -0.6,
    "downgrade": -0.6, "weak": -0.5, "recession": -0.8, "hotter": -0.5, "hawkish": -0.6,
    "hikes": -0.7, "layoffs": -0.6, "warning": -0.5, "default": -0.8, "tariff": -0.5,
    "geopolitical": -0.5, "risk-off": -0.7,
}

TEMPLATES = [
    ("{ticker} {verb} quarterly estimates as AI demand holds up", 0.6),
    ("Treasury yields {dir} after a {adj} inflation print", -0.3),
    ("Fed speakers strike a {tone} tone on the policy path", 0.2),
    ("Mega-cap earnings {verb2}, index futures {dir2} into the open", 0.5),
    ("Oil {dir3} as inventories build more than expected", -0.4),
    ("Dollar {dir4} against major peers, pressuring commodities", -0.3),
    ("Chip sector {verb3} on export-curb headlines", -0.5),
    ("Breadth improves as small caps {verb4}", 0.4),
    ("Volatility {dir5} ahead of the FOMC decision", -0.2),
    ("{country} data surprises to the {side}", 0.3),
]


@dataclass(frozen=True)
class Headline:
    ts: float
    text: str
    source: str
    sentiment: float      # -1..1
    label: str            # bullish | bearish | neutral
    matched: tuple[str, ...] = ()

    def dict(self) -> dict:
        return {
            "ts": int(self.ts),
            "time_et": datetime.fromtimestamp(self.ts, ET).strftime("%H:%M"),
            "text": self.text, "source": self.source,
            "sentiment": round(self.sentiment, 2), "label": self.label,
            "matched": list(self.matched),
        }


def score_text(text: str) -> tuple[float, str, tuple[str, ...]]:
    low = text.lower()
    score = 0.0
    matched = []
    for word, w in POSITIVE.items():
        if word in low:
            score += w
            matched.append(word)
    for word, w in NEGATIVE.items():
        if word in low:
            score += w
            matched.append(word)
    score = float(np.clip(score / 1.6, -1, 1))
    label = "bullish" if score > 0.2 else "bearish" if score < -0.2 else "neutral"
    return score, label, tuple(matched)


class NewsFeed:
    def __init__(self, config: dict) -> None:
        cfg = config or {}
        self.mode = cfg.get("news", "simulated")
        self.csv_path = Path(cfg.get("news_csv", "./data/csv/headlines.csv"))
        self._csv: list[Headline] | None = None

    def _load_csv(self) -> list[Headline]:
        if self._csv is not None:
            return self._csv
        out: list[Headline] = []
        if self.mode == "csv" and self.csv_path.exists():
            from ..data.csv_feed import _parse_ts

            lines = [ln for ln in self.csv_path.read_text(encoding="utf-8", errors="replace").splitlines() if ln.strip()]
            if lines:
                delim = ";" if ";" in lines[0] else ","
                has_header = "headline" in lines[0].lower() or "text" in lines[0].lower()
                start = 1 if has_header else 0
                for ln in lines[start:]:
                    parts = [p.strip().strip('"') for p in ln.split(delim)]
                    if len(parts) < 2:
                        continue
                    try:
                        ts = _parse_ts(parts[0])
                    except Exception:
                        continue
                    text = parts[1]
                    score, label, matched = score_text(text)
                    out.append(Headline(ts, text, parts[2] if len(parts) > 2 else "csv",
                                        score, label, matched))
        self._csv = out
        return out

    # ------------------------------------------------------------- simulated
    def _simulated_day(self, day: datetime) -> list[Headline]:
        seed = zlib.crc32(day.strftime("%Y%m%d").encode())
        rng = np.random.default_rng(seed)
        count = int(rng.integers(4, 9))
        out = []
        start = day.replace(hour=6, minute=0, second=0, microsecond=0)
        for k in range(count):
            ts = (start + timedelta(minutes=int(rng.integers(0, 12 * 60)))).timestamp()
            tpl, base = TEMPLATES[int(rng.integers(0, len(TEMPLATES)))]
            text = tpl.format(
                ticker=str(rng.choice(["NVDA", "MSFT", "AAPL", "AMZN", "META", "GOOGL"])),
                verb=str(rng.choice(["beats", "misses", "tops"])),
                verb2=str(rng.choice(["beat", "miss"])),
                verb3=str(rng.choice(["slumps", "surges", "rebounds"])),
                verb4=str(rng.choice(["outperform", "lag", "rebound"])),
                dir=str(rng.choice(["rise", "fall", "hold steady"])),
                dir2=str(rng.choice(["firm up", "slip"])),
                dir3=str(rng.choice(["climbs", "slides"])),
                dir4=str(rng.choice(["strengthens", "weakens"])),
                dir5=str(rng.choice(["picks up", "fades"])),
                adj=str(rng.choice(["cooler", "hotter", "in-line"])),
                tone=str(rng.choice(["hawkish", "dovish", "balanced"])),
                side=str(rng.choice(["upside", "downside"])),
                country=str(rng.choice(["China", "Germany", "Japan", "UK"])),
            )
            jitter = float(rng.normal(0, 0.25))
            score, label, matched = score_text(text)
            score = float(np.clip(score + jitter, -1, 1))
            label = "bullish" if score > 0.2 else "bearish" if score < -0.2 else "neutral"
            out.append(Headline(ts, text, "simulated wire", score, label, matched))
        out.sort(key=lambda h: h.ts)
        return out

    def recent(self, ts: float, hours: float = 6.0, limit: int = 8) -> list[Headline]:
        if self.mode == "csv":
            rows = [h for h in self._load_csv() if ts - hours * 3600 <= h.ts <= ts]
        else:
            day = datetime.fromtimestamp(ts, ET)
            rows = []
            for d in (day - timedelta(days=1), day):
                rows += [h for h in self._simulated_day(d) if ts - hours * 3600 <= h.ts <= ts]
        rows.sort(key=lambda h: h.ts)
        return rows[-limit:]

    def sentiment_average(self, ts: float, hours: float = 6.0) -> tuple[float, int]:
        rows = self.recent(ts, hours, limit=50)
        if not rows:
            return 0.0, 0
        return float(np.mean([h.sentiment for h in rows])), len(rows)

    def source_label(self) -> str:
        return "headlines.csv" if self.mode == "csv" else "simulated wire"
