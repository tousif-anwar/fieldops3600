"""Vectorized indicators. Every function returns a full-length array with NaN
warm-up values, so `arr[i]` depends only on bars[0..i] - no look-ahead.
"""
from __future__ import annotations

import warnings

import numpy as np

Array = np.ndarray


def _nan(n: int) -> Array:
    return np.full(n, np.nan, dtype=np.float64)


def sma(values: Array, period: int) -> Array:
    n = len(values)
    out = _nan(n)
    if period <= 0 or n < period:
        return out
    csum = np.cumsum(np.nan_to_num(values, nan=0.0))
    out[period - 1] = csum[period - 1] / period
    out[period:] = (csum[period:] - csum[:-period]) / period
    return out


def ema(values: Array, period: int) -> Array:
    n = len(values)
    out = _nan(n)
    if period <= 0 or n < period:
        return out
    alpha = 2.0 / (period + 1.0)
    seed = np.nanmean(values[:period])
    out[period - 1] = seed
    prev = seed
    for i in range(period, n):
        v = values[i]
        if not np.isfinite(v):
            v = prev
        prev = alpha * v + (1 - alpha) * prev
        out[i] = prev
    return out


def true_range(high: Array, low: Array, close: Array) -> Array:
    n = len(close)
    out = _nan(n)
    if n == 0:
        return out
    out[0] = high[0] - low[0]
    prev_close = close[:-1]
    out[1:] = np.maximum.reduce([
        high[1:] - low[1:],
        np.abs(high[1:] - prev_close),
        np.abs(low[1:] - prev_close),
    ])
    return out


def atr(high: Array, low: Array, close: Array, period: int = 14) -> Array:
    tr = true_range(high, low, close)
    n = len(tr)
    out = _nan(n)
    if n < period:
        return out
    out[period - 1] = np.nanmean(tr[:period])
    alpha = 1.0 / period
    prev = out[period - 1]
    for i in range(period, n):
        prev = alpha * tr[i] + (1 - alpha) * prev
        out[i] = prev
    return out


def rsi(close: Array, period: int = 14) -> Array:
    n = len(close)
    out = _nan(n)
    if n <= period:
        return out
    delta = np.diff(close, prepend=close[0])
    gain = np.where(delta > 0, delta, 0.0)
    loss = np.where(delta < 0, -delta, 0.0)
    avg_gain = np.nanmean(gain[1:period + 1])
    avg_loss = np.nanmean(loss[1:period + 1])
    out[period] = 100.0 if avg_loss == 0 else 100.0 - 100.0 / (1.0 + avg_gain / avg_loss)
    for i in range(period + 1, n):
        avg_gain = (avg_gain * (period - 1) + gain[i]) / period
        avg_loss = (avg_loss * (period - 1) + loss[i]) / period
        out[i] = 100.0 if avg_loss == 0 else 100.0 - 100.0 / (1.0 + avg_gain / avg_loss)
    return out


def macd(close: Array, fast: int = 12, slow: int = 26, signal: int = 9) -> tuple[Array, Array, Array]:
    line = ema(close, fast) - ema(close, slow)
    sig = np.full(len(close), np.nan)
    valid = np.flatnonzero(np.isfinite(line))
    if len(valid) >= signal:
        sub = ema(line[valid], signal)
        sig[valid] = sub
    return line, sig, line - sig


def rolling_std(values: Array, period: int) -> Array:
    n = len(values)
    out = _nan(n)
    if n < period:
        return out
    view = np.lib.stride_tricks.sliding_window_view(values, period)
    out[period - 1:] = np.nanstd(view, axis=1)
    return out


def rolling_max(values: Array, period: int) -> Array:
    n = len(values)
    out = _nan(n)
    if n < period:
        return out
    view = np.lib.stride_tricks.sliding_window_view(values, period)
    with warnings.catch_warnings():
        # an all-NaN warm-up window is expected, not a problem to report
        warnings.simplefilter("ignore", RuntimeWarning)
        out[period - 1:] = np.nanmax(view, axis=1)
    return out


def rolling_min(values: Array, period: int) -> Array:
    n = len(values)
    out = _nan(n)
    if n < period:
        return out
    view = np.lib.stride_tricks.sliding_window_view(values, period)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        out[period - 1:] = np.nanmin(view, axis=1)
    return out


def relative_volume(volume: Array, lookback: int = 20) -> Array:
    avg = sma(volume, lookback)
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(avg > 0, volume / avg, np.nan)


def percentile_rank(values: Array, window: int = 100) -> Array:
    """Percentile (0..100) of each value within its trailing window."""
    n = len(values)
    out = _nan(n)
    for i in range(n):
        start = max(0, i - window + 1)
        chunk = values[start:i + 1]
        chunk = chunk[np.isfinite(chunk)]
        if len(chunk) < 5:
            continue
        out[i] = 100.0 * float(np.mean(chunk <= values[i]))
    return out


def adx(high: Array, low: Array, close: Array, period: int = 14) -> tuple[Array, Array, Array]:
    """Wilder ADX with +DI / -DI."""
    n = len(close)
    plus_dm = np.zeros(n)
    minus_dm = np.zeros(n)
    up = np.diff(high, prepend=high[0])
    down = -np.diff(low, prepend=low[0])
    plus_dm = np.where((up > down) & (up > 0), up, 0.0)
    minus_dm = np.where((down > up) & (down > 0), down, 0.0)
    tr = np.nan_to_num(true_range(high, low, close), nan=0.0)
    atr_ = _wilder(tr, period)
    plus_di = 100.0 * _wilder(plus_dm, period) / np.where(atr_ > 0, atr_, np.nan)
    minus_di = 100.0 * _wilder(minus_dm, period) / np.where(atr_ > 0, atr_, np.nan)
    dx = 100.0 * np.abs(plus_di - minus_di) / np.where((plus_di + minus_di) > 0, plus_di + minus_di, np.nan)
    adx_ = _wilder(np.nan_to_num(dx, nan=0.0), period)
    adx_[:2 * period] = np.nan
    return adx_, plus_di, minus_di


def _wilder(values: Array, period: int) -> Array:
    n = len(values)
    out = _nan(n)
    if n < period:
        return out
    out[period - 1] = np.nanmean(values[:period])
    prev = out[period - 1]
    for i in range(period, n):
        prev = (prev * (period - 1) + values[i]) / period
        out[i] = prev
    return out


def cumulative_delta(buy: Array, sell: Array) -> Array:
    return np.cumsum(buy - sell)


def delta_divergence(close: Array, delta: Array, window: int = 14) -> Array:
    """+1 when price makes a higher high but delta does not (bearish), -1 mirror.

    Returns an array of {-1,0,1} evaluated on trailing windows.
    """
    n = len(close)
    out = np.zeros(n)
    for i in range(window, n):
        p_now, p_prev = close[i], close[i - window]
        d_now = float(np.nansum(delta[i - window + 1:i + 1]))
        d_prev = float(np.nansum(delta[i - 2 * window + 1:i - window + 1])) if i >= 2 * window else 0.0
        if d_now == 0 or d_prev == 0:
            continue
        if p_now > p_prev and d_now < d_prev * 0.75:
            out[i] = 1   # bearish divergence
        elif p_now < p_prev and d_now > d_prev * 1.25:
            out[i] = -1  # bullish divergence
    return out


def efficiency_ratio(close: Array, period: int = 20) -> Array:
    """Kaufman efficiency ratio: 1 = clean trend, ~0 = chop."""
    n = len(close)
    out = _nan(n)
    for i in range(period, n):
        direction = abs(close[i] - close[i - period])
        volatility = float(np.nansum(np.abs(np.diff(close[i - period:i + 1]))))
        out[i] = direction / volatility if volatility > 0 else 0.0
    return out


def slope(values: Array, period: int = 20) -> Array:
    """Normalised least-squares slope over the trailing window (per bar, in ATR-free units)."""
    n = len(values)
    out = _nan(n)
    x = np.arange(period, dtype=np.float64)
    x_mean = x.mean()
    denom = float(((x - x_mean) ** 2).sum())
    for i in range(period - 1, n):
        y = values[i - period + 1:i + 1]
        if not np.all(np.isfinite(y)):
            continue
        out[i] = float(((x - x_mean) * (y - y.mean())).sum() / denom)
    return out


def zscore(values: Array, period: int = 20) -> Array:
    mean = sma(values, period)
    std = rolling_std(values, period)
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(std > 0, (values - mean) / std, np.nan)


def bollinger(close: Array, period: int = 20, k: float = 2.0) -> tuple[Array, Array, Array, Array]:
    """Bands plus normalised bandwidth. Bandwidth is the width as a fraction of
    the mid line, so it can be ranked across regimes with different price levels."""
    mid = sma(close, period)
    sd = rolling_std(close, period)
    upper = mid + k * sd
    lower = mid - k * sd
    with np.errstate(divide="ignore", invalid="ignore"):
        width = np.where(mid > 0, (upper - lower) / mid, np.nan)
    return mid, upper, lower, width


def donchian(high: Array, low: Array, period: int = 20, shift: int = 1) -> tuple[Array, Array]:
    """Trailing channel, shifted back so `[i]` covers bars `i-shift-period+1..i-shift`.

    The shift is what makes a breakout measurable: the current bar is never part
    of the channel it is being compared against.
    """
    up = rolling_max(high, period)
    dn = rolling_min(low, period)
    if shift <= 0:
        return up, dn
    n = len(up)
    shifted_up = _nan(n)
    shifted_dn = _nan(n)
    if n > shift:
        shifted_up[shift:] = up[:-shift]
        shifted_dn[shift:] = dn[:-shift]
    return shifted_up, shifted_dn


def volume_delta(high: Array, low: Array, close: Array, volume: Array) -> Array:
    """Candle-implied delta proxy in volume units.

    Without tick data the buy/sell split is unknown, so this uses the close
    position inside each bar's range: a close at the high scores +1, at the low
    -1. It is an approximation, and the UI labels it as such.
    """
    span = high - low
    with np.errstate(divide="ignore", invalid="ignore"):
        skew = np.where(span > 0, (2.0 * close - high - low) / span, 0.0)
    return np.nan_to_num(skew, nan=0.0) * np.nan_to_num(volume, nan=0.0)


def half_life(values: Array, window: int = 60) -> Array:
    """Bars for a deviation from the rolling mean to decay by half.

    AR(1) fit on the demeaned series over a trailing window:
    `d_t = a + b * dev_{t-1}`; half-life = -ln2 / ln(1 + b). A positive or tiny
    negative `b` means no usable reversion, which returns NaN rather than a
    large number that would look like a measurement.
    """
    n = len(values)
    out = _nan(n)
    if n < window + 1:
        return out
    dev = values - sma(values, window)
    dev = np.where(np.isfinite(dev), dev, 0.0)
    view = np.lib.stride_tricks.sliding_window_view(dev, window + 1)
    y = np.diff(view, axis=1)
    x = view[:, :-1]
    x_mean = x.mean(axis=1, keepdims=True)
    y_mean = y.mean(axis=1, keepdims=True)
    dx = x - x_mean
    denom = (dx * dx).sum(axis=1)
    with np.errstate(divide="ignore", invalid="ignore"):
        beta = np.where(denom > 0, (dx * (y - y_mean)).sum(axis=1) / denom, np.nan)
    usable = np.isfinite(beta) & (beta < -1e-6) & (beta > -0.999)
    with np.errstate(divide="ignore", invalid="ignore"):
        hl = np.where(usable, -np.log(2.0) / np.log(1.0 + beta), np.nan)
    hl = np.where(hl > 0.5, np.minimum(hl, 500.0), np.nan)
    out[window:] = hl
    return out


def variance_ratio(close: Array, window: int = 100, q: int = 5) -> Array:
    """Lo-MacKinlay variance ratio over a trailing window.

    VR < 1 means negative autocorrelation (mean reverting), VR > 1 positive
    autocorrelation (trending), VR near 1 is a random walk. q-period returns are
    taken non-overlapping so the ratio is not inflated by overlap.
    """
    n = len(close)
    out = _nan(n)
    if n < window + 2 or q < 2:
        return out
    with np.errstate(divide="ignore", invalid="ignore"):
        rets = np.diff(np.log(np.where(close > 0, close, np.nan)), prepend=np.nan)
    rets = np.nan_to_num(rets, nan=0.0)
    for i in range(window, n):
        seg = rets[i - window + 1:i + 1]
        v1 = float(np.var(seg, ddof=1))
        if v1 <= 0:
            continue
        m = len(seg) // q
        if m < 4:
            continue
        sums = seg[:m * q].reshape(m, q).sum(axis=1)
        vq = float(np.var(sums, ddof=1))
        out[i] = vq / (q * v1)
    return out


def rolling_sum(values: Array, period: int) -> Array:
    """Trailing sum that ignores nothing: NaN in the window makes the result NaN."""
    n = len(values)
    out = _nan(n)
    if period <= 0 or n < period:
        return out
    clean = np.where(np.isfinite(values), values, np.nan)
    filled = np.where(np.isfinite(clean), clean, 0.0)
    valid = np.isfinite(clean).astype(np.float64)
    csum = np.cumsum(filled)
    cvsum = np.cumsum(valid)
    out[period - 1] = csum[period - 1]
    out[period:] = csum[period:] - csum[:-period]
    counts = np.full(n, np.nan)
    counts[period - 1] = cvsum[period - 1]
    counts[period:] = cvsum[period:] - cvsum[:-period]
    return np.where(counts >= period, out, np.nan)


def stoch_rsi(close: Array, period: int = 14, smooth: int = 3) -> Array:
    """Stochastic RSI 0..100, smoothed. 100 means RSI is at its window high."""
    r = rsi(close, period)
    lo = rolling_min(r, period)
    hi = rolling_max(r, period)
    span = hi - lo
    with np.errstate(divide="ignore", invalid="ignore"):
        raw = np.where(span > 0, 100.0 * (r - lo) / span, np.nan)
    num = rolling_sum(raw, smooth)
    count = rolling_sum(np.where(np.isfinite(raw), 1.0, np.nan), smooth)
    with np.errstate(divide="ignore", invalid="ignore"):
        out = np.where(count >= smooth, num / count, np.nan)
    return out


def supertrend(high: Array, low: Array, close: Array, period: int = 10,
               multiplier: float = 3.0) -> tuple[Array, Array]:
    """ATR trailing stop. Returns (line, direction) with direction +1 up / -1 down.

    The bands ratchet: the upper band only falls and the lower band only rises
    until price closes through one of them, which is what makes the line a
    trailing stop rather than a channel.
    """
    n = len(close)
    atr_ = atr(high, low, close, period)
    line = _nan(n)
    direction = np.zeros(n, dtype=np.float64)
    upper = _nan(n)
    lower = _nan(n)
    hl2 = (high + low) / 2.0
    up_basic = hl2 + multiplier * atr_
    lo_basic = hl2 - multiplier * atr_
    start = None
    for i in range(n):
        if not np.isfinite(atr_[i]):
            continue
        if start is None:
            start = i
            upper[i] = up_basic[i]
            lower[i] = lo_basic[i]
            direction[i] = 1.0
            line[i] = lower[i]
            continue
        prev_up, prev_lo = upper[i - 1], lower[i - 1]
        upper[i] = up_basic[i] if (up_basic[i] < prev_up or close[i - 1] > prev_up) else prev_up
        lower[i] = lo_basic[i] if (lo_basic[i] > prev_lo or close[i - 1] < prev_lo) else prev_lo
        if close[i] > prev_up:
            direction[i] = 1.0
        elif close[i] < prev_lo:
            direction[i] = -1.0
        else:
            direction[i] = direction[i - 1]
        line[i] = lower[i] if direction[i] > 0 else upper[i]
    return line, direction


def quantum_shift(high: Array, low: Array, close: Array, rel_volume: Array,
                  ema_fast: Array, ema_slow: Array,
                  min_rel_volume: float = 1.2) -> tuple[Array, Array]:
    """Momentum-shift event detector, built from stated public mechanics.

    Not the vendor script: that is closed source. This is an independent,
    documented implementation of the mechanism such tools describe, namely an
    EMA trend state plus a volume-triggered reversal candle against it.

    A shift fires when price trades through the fast EMA and closes back on the
    other side in the outer 40% of the bar's range, on at least
    `min_rel_volume` times average volume, in the direction opposite the state
    that was in force. Returns (shift, score) where shift is +1/-1 on the event
    bar and 0 elsewhere, and score is 0..1 confidence.
    """
    n = len(close)
    shift = np.zeros(n)
    score = np.zeros(n)
    state = 0
    for i in range(2, n):
        # compare against the EMA as it stood before this bar: the bar's own
        # close must not be part of the level it is reclaiming
        fast = ema_fast[i - 1]
        slow = ema_slow[i - 1]
        if not (np.isfinite(fast) and np.isfinite(slow)):
            continue
        bull_state = 1 if (close[i] > fast > slow) else -1 if (close[i] < fast < slow) else 0
        span = high[i] - low[i]
        if span <= 0:
            state = bull_state or state
            continue
        close_position = (close[i] - low[i]) / span
        vol_ratio = float(rel_volume[i]) if np.isfinite(rel_volume[i]) else 0.0
        volume_ok = vol_ratio >= min_rel_volume
        reclaim_up = low[i] < fast <= close[i] and close_position >= 0.60
        reclaim_down = high[i] > fast >= close[i] and close_position <= 0.40
        if volume_ok and (reclaim_up or reclaim_down):
            event_direction = 1 if reclaim_up else -1
            if event_direction != state:
                shift[i] = event_direction
                edge = abs(close_position - 0.5) * 2.0
                score[i] = min(1.0, 0.45 + 0.30 * min(1.0, max(0.0, vol_ratio - 1.0)) + 0.25 * edge)
        if bull_state:
            state = bull_state
    return shift, score


def last_valid(arr: Array, default: float | None = None) -> float | None:
    if arr is None or len(arr) == 0:
        return default
    idx = np.flatnonzero(np.isfinite(arr))
    if len(idx) == 0:
        return default
    return float(arr[idx[-1]])


def series_tail(arr: Array, n: int = 300) -> list[float | None]:
    tail = arr[-n:] if len(arr) > n else arr
    return [None if not np.isfinite(v) else round(float(v), 6) for v in tail]
