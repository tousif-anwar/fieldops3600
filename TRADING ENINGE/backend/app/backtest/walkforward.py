"""Walk-forward validation + a strictly untouched hold-out segment.

Rules enforced here:
  * parameters are chosen on in-sample data only
  * the out-of-sample fold decides the reported walk-forward performance
  * the hold-out tail is never used for parameter selection
"""
from __future__ import annotations

from . import metrics as metrics_mod
from .engine import Backtester

DEFAULT_GRID = [
    {"threshold": 55, "min_rr": 1.3},
    {"threshold": 55, "min_rr": 1.8},
    {"threshold": 64, "min_rr": 1.3},
    {"threshold": 64, "min_rr": 1.8},
]


def run(
    cfg, book, registry, fundamentals, svc,
    symbol: str, timeframe: str = "5m", bars: int = 2500,
    folds: int = 3, train_fraction: float = 0.7,
    holdout_fraction: float = 0.2, grid: list[dict] | None = None,
) -> dict:
    bt = Backtester(cfg, book, registry, fundamentals, svc)
    frame = svc.frame(symbol, timeframe, bars)
    total = len(frame)
    warmup = int(cfg.backtest.get("warmup_bars", 250))
    if total < warmup + 120:
        return {"error": "not enough bars for walk-forward", "warnings":
                [f"need at least {warmup + 120} bars, got {total}"]}
    holdout_start = int(total * (1 - holdout_fraction))
    usable_start = warmup
    usable_end = max(usable_start + 60, holdout_start - 1)
    block = max(40, (usable_end - usable_start) // max(1, folds))
    grid = grid or DEFAULT_GRID

    fold_rows = []
    oos_trades: list[dict] = []
    chosen = grid[0]
    for f in range(folds):
        bs = usable_start + f * block
        be = min(usable_end, bs + block - 1)
        if be - bs < 40:
            break
        split = bs + int((be - bs) * train_fraction)
        best = None
        for params in grid:
            r = bt.run(symbol, timeframe, bars=bars, start_index=bs, end_index=split,
                       signal_overrides={"threshold": params["threshold"]},
                       risk_overrides={"min_rr": params["min_rr"]}, label="in-sample")
            m = r.get("metrics", {})
            key = (m.get("expectancy_r") if m.get("expectancy_r") is not None else -9.0,
                   m.get("trades", 0))
            if m.get("trades", 0) >= 5 and (best is None or key > best[0]):
                best = (key, params, m)
        if best is None:
            fold_rows.append({
                "fold": f + 1, "train_bars": split - bs, "test_bars": be - split,
                "note": "skipped: no parameter set produced enough in-sample trades",
                "in_sample": None, "out_of_sample": None,
            })
            continue
        chosen = best[1]
        oos = bt.run(symbol, timeframe, bars=bars, start_index=split + 1, end_index=be,
                     signal_overrides={"threshold": chosen["threshold"]},
                     risk_overrides={"min_rr": chosen["min_rr"]}, label="out-of-sample")
        oos_trades.extend(oos.get("trades", []))
        fold_rows.append({
            "fold": f + 1,
            "train_start": oos.get("start_ts"),
            "train_bars": split - bs,
            "test_bars": be - split,
            "chosen_params": chosen,
            "in_sample": best[2],
            "out_of_sample": oos.get("metrics"),
            "out_of_sample_hash": oos.get("reproducible_hash"),
            "warnings": oos.get("warnings", []),
        })

    holdout = bt.run(symbol, timeframe, bars=bars, start_index=holdout_start, end_index=total - 1,
                     signal_overrides={"threshold": chosen["threshold"]},
                     risk_overrides={"min_rr": chosen["min_rr"]}, label="hold-out")
    oos_metrics = metrics_mod.full_report(oos_trades, float(cfg.risk.get("account_size", 25000)))
    warnings = []
    if oos_metrics.get("trades", 0) < 30:
        warnings.append(f"Walk-forward produced only {oos_metrics.get('trades', 0)} out-of-sample trades - "
                        "treat conclusions as provisional.")
    if holdout.get("metrics", {}).get("trades", 0) < 10:
        warnings.append("Hold-out segment has too few trades to be conclusive; it was not tuned on.")
    degradation = None
    is_exp = [f["in_sample"]["expectancy_r"] for f in fold_rows if f.get("in_sample")]
    oos_exp = oos_metrics.get("expectancy_r")
    if is_exp and oos_exp is not None:
        degradation = round(oos_exp - (sum(is_exp) / len(is_exp)), 3)
        if degradation < -0.2:
            warnings.append(f"Out-of-sample expectancy is {degradation:+.2f}R versus in-sample - "
                            "possible overfitting.")
    return {
        "symbol": symbol.upper(),
        "timeframe": timeframe,
        "folds": fold_rows,
        "fold_count": len(fold_rows),
        "oos_metrics": oos_metrics,
        "oos_trades": oos_trades,
        "holdout": {k: holdout.get(k) for k in ("metrics", "trades", "warnings",
                                                "reproducible_hash", "start_ts", "end_ts")},
        "chosen_params": chosen,
        "expectancy_degradation_r": degradation,
        "method": ("Parameters chosen on each fold's in-sample window only. Reported walk-forward "
                   "numbers come from the untouched out-of-sample folds. The final hold-out tail is "
                   "evaluated once with the last chosen parameters."),
        "warnings": warnings + ([] if not frame.synthetic else
                                ["Walk-forward ran on SIMULATED data."]),
    }
