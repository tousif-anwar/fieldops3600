"""Fundamental bias: calendar proximity + cross-asset context + headline sentiment.

The bias is explicitly a filter and confidence modifier. It never creates an
entry on its own.
"""
from __future__ import annotations

from .calendar import EconomicCalendar
from .index_context import IndexContext
from .news import NewsFeed

DISCLAIMER = (
    "Futures trading involves substantial risk of loss. This application is "
    "decision-support tooling, not financial advice. It never sends orders."
)


class FundamentalService:
    def __init__(self, config: dict) -> None:
        self.cfg = config or {}
        self.calendar = EconomicCalendar(self.cfg)
        self.news = NewsFeed(self.cfg)
        self.index = IndexContext(self.cfg)
        self.high_impact_size = float(self.cfg.get("high_impact_size_multiplier", 0.5))
        self._cache: dict[tuple, dict] = {}

    # ------------------------------------------------------------------ bias
    def pack(self, symbol: str, sector: str, ts: float) -> dict:
        key = (symbol, int(ts // 900))
        hit = self._cache.get(key)
        if hit is not None:
            return hit
        idx = self.index.snapshot(ts, sector)
        window = self.calendar.window_state(ts, sector)
        sentiment, n_news = self.news.sentiment_average(ts, hours=6)
        headlines = [h.dict() for h in self.news.recent(ts, hours=6, limit=6)]

        score = 0.0
        reasons: list[str] = []
        vix = idx.get("vix") or {}
        y10 = idx.get("yield_10y") or {}
        dxy = idx.get("dxy") or {}
        if vix:
            if vix["value"] >= 22:
                score -= 0.2
                reasons.append(f"VIX {vix['value']:.1f} , a risk-off volatility regime")
            elif vix["value"] <= 15:
                score += 0.12
                reasons.append(f"VIX {vix['value']:.1f} , a calm volatility regime")
            if vix["trend"] == "rising" and vix["value"] > 18:
                score -= 0.1
                reasons.append("VIX trend is rising, hedging demand is building")
            elif vix["trend"] == "falling" and vix["value"] < 20:
                score += 0.08
                reasons.append("VIX trend is falling, risk appetite is improving")
        if y10:
            if y10["trend"] == "rising":
                score -= 0.08
                reasons.append(f"10Y yield rising to {y10['value']:.2f}%, a valuation headwind")
            elif y10["trend"] == "falling":
                score += 0.08
                reasons.append(f"10Y yield falling to {y10['value']:.2f}%, a valuation tailwind")
        if dxy:
            if dxy["trend"] == "rising":
                score -= 0.06
                reasons.append(f"Dollar index rising ({dxy['value']:.2f})")
            elif dxy["trend"] == "falling":
                score += 0.06
                reasons.append(f"Dollar index falling ({dxy['value']:.2f})")
        if n_news:
            score += float(sentiment) * 0.35
            if abs(sentiment) > 0.15:
                reasons.append(f"{n_news} headlines in the last 6h, average sentiment {sentiment:+.2f}")
        comm = idx.get("commodity")
        if comm:
            if sector == "energy":
                chg = comm.get("inventory_change_mbbl", 0)
                if chg > 2.0:
                    score -= 0.12
                    reasons.append(f"Crude inventories built {chg:+.1f} mbbl, bearish for supply")
                elif chg < -2.0:
                    score += 0.12
                    reasons.append(f"Crude inventories drew {-chg:.1f} mbbl, bullish for supply")
            if sector == "grains":
                bias = comm.get("wasde_bias")
                if bias == "tighter":
                    score += 0.15
                    reasons.append("WASDE bias tighter, supportive for grains")
                elif bias == "looser":
                    score -= 0.15
                    reasons.append("WASDE bias looser, bearish for grains")
        if window["active"]:
            reasons.append(f"{window['reason']}. Trading window restricted.")
        earnings = idx.get("earnings") or []
        if earnings:
            names = ", ".join(e["name"] for e in earnings[:3])
            reasons.append(f"Mega-cap earnings due ({names}). Headline risk is elevated.")

        score = max(-1.0, min(1.0, score))
        bias = "bullish" if score >= 0.15 else "bearish" if score <= -0.15 else "neutral"
        size_mult = 1.0
        if window["active"] and window.get("impact") == "high":
            size_mult = min(size_mult, self.high_impact_size)
        if idx.get("vix", {}).get("value", 0) >= 25:
            size_mult = min(size_mult, 0.6)
        if earnings and sector == "equity_index":
            size_mult = min(size_mult, 0.8)

        pack = {
            "bias": bias,
            "score": round(score, 3),
            "reasons": reasons or ["No decisive fundamental drivers."],
            "news_window": bool(window["active"]),
            "news_window_detail": window,
            "size_multiplier": round(size_mult, 2),
            "events": self.calendar.upcoming(ts, sector, count=6),
            "headlines": headlines,
            "index_context": idx,
            "providers": {
                "calendar": self.calendar.source_label(),
                "news": self.news.source_label(),
                "index": self.index.source_label(),
            },
            "disclaimer": DISCLAIMER,
        }
        self._cache[key] = pack
        if len(self._cache) > 4000:
            self._cache.clear()
        return pack
