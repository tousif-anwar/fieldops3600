import { useEffect, useRef, useState } from 'react';
import {
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Analysis, Detail, Layers } from '../types';

interface Props {
  analysis: Analysis;
  layers: Layers;
  theme: 'dark' | 'light';
  onSelect: (detail: Detail | null) => void;
}

const PALETTE = {
  dark: {
    bg: '#0c1219', text: '#8494a6', grid: '#151e28', border: '#1f2b38',
    up: '#22c55e', down: '#f43f5e', volumeUp: 'rgba(34,197,94,0.32)',
    volumeDown: 'rgba(244,63,94,0.32)',
  },
  light: {
    bg: '#ffffff', text: '#5a6b7c', grid: '#eef2f6', border: '#dfe5ec',
    up: '#15803d', down: '#be123c', volumeUp: 'rgba(21,128,61,0.25)',
    volumeDown: 'rgba(190,18,60,0.22)',
  },
};

const LEVEL_KINDS = new Set([
  'pdh', 'pdl', 'pwh', 'pwl', 'pmh', 'pml', 'onh', 'onl', 'orh', 'orl',
  'poc', 'vah', 'val', 'naked_poc', 'rth_open', 'equal_highs', 'equal_lows',
]);

const pivotColor = (kind: string) => (kind.endsWith('pp')
  ? 'rgba(163, 163, 163, 0.5)'
  : kind.includes('_r')
    ? 'rgba(248, 113, 113, 0.45)'
    : 'rgba(74, 222, 128, 0.45)');

export default function Chart({ analysis, layers, theme, onSelect }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const vpRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const overlayRef = useRef<Record<string, ISeriesApi<'Line'>>>({});
  const priceLines = useRef<IPriceLine[]>([]);
  const analysisRef = useRef<Analysis>(analysis);
  const layersRef = useRef<Layers>(layers);
  const hitsRef = useRef<Array<{ time: number; price: number; detail: Detail }>>([]);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; detail: Detail } | null>(null);
  const lastKey = useRef<string>('');
  const themeRef = useRef<'dark' | 'light'>(theme);

  analysisRef.current = analysis;
  layersRef.current = layers;
  themeRef.current = theme;

  // ---------------------------------------------------------------- creation
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const p = PALETTE[theme];
    const chart = createChart(host, {
      width: host.clientWidth,
      height: host.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: p.bg },
        textColor: p.text,
        fontSize: 11,
        fontFamily: "ui-monospace, 'Cascadia Mono', Menlo, monospace",
      },
      grid: { vertLines: { color: p.grid }, horzLines: { color: p.grid } },
      rightPriceScale: { borderColor: p.border, scaleMargins: { top: 0.06, bottom: 0.22 } },
      timeScale: {
        borderColor: p.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
        barSpacing: 7,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: p.border, width: 1, style: LineStyle.Dotted, labelBackgroundColor: '#1f2937' },
        horzLine: { color: p.border, width: 1, style: LineStyle.Dotted, labelBackgroundColor: '#1f2937' },
      },
      localization: {
        timeFormatter: (t: any) =>
          new Date(Number(t) * 1000).toLocaleString('en-US', {
            timeZone: 'America/New_York', month: 'short', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: false,
          }),
      },
    });
    chartRef.current = chart;

    const candles = chart.addCandlestickSeries({
      upColor: p.up, downColor: p.down, borderVisible: false,
      wickUpColor: p.up, wickDownColor: p.down,
      priceLineVisible: true, priceLineColor: p.border,
    });
    candleRef.current = candles;

    const volume = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
      priceLineVisible: false,
      lastValueVisible: false,
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    volumeRef.current = volume;

    const definitions: Array<[string, string, number]> = [
      ['ema9', '#60a5fa', 1], ['ema21', '#f59e0b', 1], ['ema50', '#a78bfa', 1],
      ['ema200', '#94a3b8', 1], ['vwap', '#22d3ee', 2],
      ['vwap_upper1', 'rgba(34,211,238,0.45)', 1], ['vwap_lower1', 'rgba(34,211,238,0.45)', 1],
      ['vwap_upper2', 'rgba(34,211,238,0.22)', 1], ['vwap_lower2', 'rgba(34,211,238,0.22)', 1],
      ['supertrend_up', 'rgba(52,196,111,0.85)', 2], ['supertrend_down', 'rgba(242,85,109,0.85)', 2],
    ];
    for (const [key, color, width] of definitions) {
      overlayRef.current[key] = chart.addLineSeries({
        color, lineWidth: width as any, priceLineVisible: false,
        lastValueVisible: false, crosshairMarkerVisible: false,
      });
    }

    chart.timeScale().subscribeVisibleLogicalRangeChange(() => drawVolume());
    chart.subscribeClick((param) => handleClick(param));

    const ro = new ResizeObserver(() => {
      if (!hostRef.current) return;
      chart.applyOptions({ width: hostRef.current.clientWidth, height: hostRef.current.clientHeight });
      drawVolume();
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      overlayRef.current = {};
      priceLines.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------- theme
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const p = PALETTE[theme];
    chart.applyOptions({
      layout: { background: { type: ColorType.Solid, color: p.bg }, textColor: p.text },
      grid: { vertLines: { color: p.grid }, horzLines: { color: p.grid } },
      rightPriceScale: { borderColor: p.border },
      timeScale: { borderColor: p.border },
    });
    candleRef.current?.applyOptions({
      upColor: p.up, downColor: p.down, wickUpColor: p.up, wickDownColor: p.down,
    });
    drawVolume();
    setTooltip(null);
  }, [theme]);

  // -------------------------------------------------------------------- data
  useEffect(() => {
    const chart = chartRef.current;
    const candles = candleRef.current;
    const volume = volumeRef.current;
    if (!chart || !candles || !volume || !analysis) return;

    const rows = analysis.series.candles as any[];
    candles.setData(rows.map((r) => ({
      time: r.time as UTCTimestamp, open: r.open, high: r.high, low: r.low, close: r.close,
    })));
    const p = PALETTE[theme];
    volume.setData(rows.map((r) => ({
      time: r.time as UTCTimestamp,
      value: r.volume,
      color: r.close >= r.open ? p.volumeUp : p.volumeDown,
    })));

    for (const [key, series] of Object.entries(overlayRef.current)) {
      const points = analysis.series.overlays?.[key] || [];
      // a point with no value is whitespace: it breaks the line instead of
      // interpolating across bars where that series was not active
      series.setData(points.map((pt: any) => (pt.value === undefined || pt.value === null
        ? { time: pt.time as UTCTimestamp }
        : { time: pt.time as UTCTimestamp, value: pt.value })));
      series.applyOptions({ visible: true });
    }

    const key = `${analysis.symbol}|${analysis.timeframe}|${analysis.provider.id}`;
    if (lastKey.current !== key) {
      lastKey.current = key;
      // Fit-to-content squeezes every bar into the pane, which turns candles and
      // markers into noise. Open on a readable window at the right edge instead.
      const visible = Math.min(160, rows.length);
      chart.timeScale().setVisibleLogicalRange({ from: rows.length - visible, to: rows.length + 4 });
    }

    buildMarkers(analysis, layersRef.current);
    buildPriceLines(analysis, layersRef.current);
    drawVolume();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis]);

  // ------------------------------------------------------------------ layers
  useEffect(() => {
    const candle = candleRef.current;
    if (!candle || !analysis) return;
    const ov = overlayRef.current;
    for (const k of ['ema9', 'ema21', 'ema50', 'ema200']) {
      ov[k]?.applyOptions({ visible: layers.emas });
    }
    for (const k of ['vwap', 'vwap_upper1', 'vwap_lower1', 'vwap_upper2', 'vwap_lower2']) {
      ov[k]?.applyOptions({ visible: layers.vwap });
    }
    for (const k of ['supertrend_up', 'supertrend_down']) {
      ov[k]?.applyOptions({ visible: layers.supertrend });
    }
    volumeRef.current?.applyOptions({ visible: layers.volume });
    buildMarkers(analysis, layers);
    buildPriceLines(analysis, layers);
    drawVolume();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers]);

  // -------------------------------------------------------------- price lines
  function buildPriceLines(a: Analysis, l: Layers) {
    const candle = candleRef.current;
    if (!candle) return;
    for (const line of priceLines.current) {
      try { candle.removePriceLine(line); } catch { /* already gone */ }
    }
    priceLines.current = [];
    const atr = Number(a.context?.indicators?.atr || 1);
    const signal = a.signal?.state === 'signal' ? a.signal.signal : null;
    const distance = (price: number) => Math.abs(price - a.context.price);

    // Floor pivots stay out of the labelled level budget: seven of them would
    // crowd out the session and value-area lines that matter more intraday.
    if (l.pivots) {
      for (const lv of (a.levels as any[]).filter((x) => String(x.kind).startsWith('pivot_'))) {
        priceLines.current.push(candle.createPriceLine({
          price: lv.price, color: pivotColor(String(lv.kind)), lineWidth: 1 as any,
          lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '',
        }));
      }
    }

    if (l.levels) {
      const candidates = (a.levels as any[])
        .filter((lv) => LEVEL_KINDS.has(lv.kind))
        .filter((lv) => lv.strength >= 0.55)
        .sort((x, y) => distance(x.price) - distance(y.price))
        .slice(0, 10);
      // price-axis labels collide when levels sit close together, so at most
      // three of them are labelled and each sits at least 0.6 ATR from the next
      const labelled: number[] = [];
      for (const lv of candidates) {
        const important = ['pdh', 'pdl', 'pwh', 'pwl', 'pmh', 'pml'].includes(lv.kind);
        const canLabel = important && labelled.length < 2
          && labelled.every((p) => Math.abs(p - lv.price) >= atr * 0.9);
        if (canLabel) labelled.push(lv.price);
        priceLines.current.push(candle.createPriceLine({
          price: lv.price,
          color: lv.color,
          lineWidth: (important ? 2 : 1) as any,
          lineStyle: important ? LineStyle.Solid : LineStyle.Dashed,
          axisLabelVisible: canLabel,
          title: canLabel ? lv.label.replace(' (developing)', '') : '',
        }));
      }
    }
    if (l.valueArea) {
      for (const lv of (a.levels as any[]).filter((x) => ['poc', 'vah', 'val'].includes(x.kind))) {
        priceLines.current.push(candle.createPriceLine({
          price: lv.price, color: '#dcae3c', lineWidth: 1 as any,
          lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '',
        }));
      }
    }
    if (l.zones && a.zones) {
      for (const z of (a.zones as any[]).slice(0, 3)) {
        for (const price of [z.low, z.high]) {
          priceLines.current.push(candle.createPriceLine({
            price, color: z.kind === 'demand' ? 'rgba(16,185,129,0.55)' : 'rgba(244,63,94,0.55)',
            lineWidth: 1 as any, lineStyle: LineStyle.SparseDotted, axisLabelVisible: false,
            title: z.kind === 'demand' ? 'demand' : 'supply',
          }));
        }
      }
    }
    if (l.signals && signal) {
      const add = (price: number, color: string, title: string, style: LineStyle) =>
        priceLines.current.push(candle.createPriceLine({
          price, color, lineWidth: (price === signal.entry.price ? 2 : 1) as any,
          lineStyle: style, axisLabelVisible: true, title,
        }));
      add(signal.entry.price, '#f5a524', `ENTRY ${signal.entry.price}`, LineStyle.Solid);
      add(signal.stop.price, '#f43f5e', `STOP ${signal.stop.price}`, LineStyle.Dashed);
      for (const t of signal.targets) add(t.price, '#22c55e', `${t.label} ${t.price}`, LineStyle.Dotted);
    }

    // click targets for levels
    const hits = hitsRef.current.filter((h) => h.detail.kind !== 'level');
    if (l.levels) {
      for (const lv of (a.levels as any[]).slice(0, 40)) {
        hits.push({
          time: 0, price: lv.price,
          detail: {
            title: lv.label,
            subtitle: `${lv.kind.toUpperCase()} · strength ${lv.strength.toFixed(2)}`,
            body: lv.detail,
            kind: 'level',
            meta: [
              { label: 'Price', value: String(lv.price) },
              { label: 'Distance', value: `${lv.distance_ticks} ticks` },
              { label: 'Group', value: lv.group },
              { label: 'Tags', value: (lv.tags || []).join(', ') || '–' },
            ],
          },
        });
      }
    }
    hitsRef.current = hits;
  }

  // ----------------------------------------------------------------- markers
  function buildMarkers(a: Analysis, l: Layers) {
    const candle = candleRef.current;
    if (!candle) return;
    const markers: any[] = [];
    const seen = new Set<string>();
    const push = (m: any) => {
      const key = `${m.time}|${m.shape}|${m.text}|${m.position}`;
      if (seen.has(key)) return;
      seen.add(key);
      markers.push(m);
    };
    // Only the newest markers carry text. A label on every sweep and BOS turns
    // the chart into unreadable soup, so history keeps the shape and loses the word.
    const rows = (a.series?.candles || []) as any[];
    const backFrom = (n: number) => (rows.length ? rows[Math.max(0, rows.length - n)].time : 0);
    const labelTail = backFrom(28);
    const structureTail = backFrom(10);

    if (l.structure) {
      for (const ev of a.markers.structure || []) {
        push({
          time: ev.time, position: ev.direction === 'bull' ? 'belowBar' : 'aboveBar',
          color: ev.direction === 'bull' ? '#22c55e' : '#f43f5e',
          shape: ev.direction === 'bull' ? 'arrowUp' : 'arrowDown',
          text: ev.time >= structureTail ? ev.kind : '',
        });
      }
    }
    if (l.swings) {
      for (const s of a.markers.swings || []) {
        push({
          time: s.time, position: s.kind === 'high' ? 'aboveBar' : 'belowBar',
          color: '#64748b', shape: 'circle', text: '',
        });
      }
    }
    if (l.sweeps) {
      // weak sweeps are dropped from the chart and kept in the click targets
      const sweeps = (a.markers.sweeps || [])
        .filter((s: any) => (s.confidence ?? 0) >= 0.7 || s.time >= labelTail)
        .slice(-40);
      for (const s of sweeps) {
        push({
          time: s.time, position: s.direction === 'bull' ? 'belowBar' : 'aboveBar',
          color: 'rgba(232, 121, 249, 0.62)', shape: 'circle',
          text: s.time >= labelTail ? 'sweep' : '',
        });
      }
    }
    if (l.icebergs) {
      for (const ice of a.markers.icebergs || []) {
        push({
          time: ice.time, position: ice.side === 'bid' ? 'belowBar' : 'aboveBar',
          color: '#a78bfa', shape: 'circle', text: ice.time >= labelTail ? 'iceberg?' : '',
        });
      }
    }
    if (l.quantumShift) {
      for (const s of a.markers.shifts || []) {
        push({
          time: s.time, position: s.direction === 'bull' ? 'belowBar' : 'aboveBar',
          color: s.direction === 'bull' ? '#60a5fa' : '#a78bfa',
          shape: 'circle', text: s.time >= labelTail ? 'shift' : '',
        });
      }
    }
    if (l.signals) {
      for (const s of a.markers.signals || []) {
        push({
          time: s.time, position: s.direction === 'long' ? 'belowBar' : 'aboveBar',
          color: s.direction === 'long' ? '#22c55e' : '#f43f5e',
          shape: 'arrowUp', text: `${s.score}`,
        });
      }
    }
    markers.sort((x, y) => x.time - y.time);
    candle.setMarkers(markers);

    // click targets for markers
    const others = hitsRef.current.filter((h) => h.detail.kind === 'level');
    const markerHits: typeof others = [];
    if (l.structure) {
      for (const ev of a.markers.structure || []) {
        markerHits.push({
          time: ev.time, price: ev.price,
          detail: {
            title: `${ev.kind} · ${ev.direction}`,
            subtitle: 'Market structure',
            body: ev.reason,
            kind: 'structure',
            meta: [{ label: 'Level', value: String(ev.price) }, { label: 'Type', value: ev.kind }],
          },
        });
      }
    }
    if (l.sweeps) {
      for (const s of a.markers.sweeps || []) {
        markerHits.push({
          time: s.time, price: s.price,
          detail: {
            title: s.label,
            subtitle: `Liquidity sweep · confidence ${Math.round((s.confidence || 0) * 100)}%`,
            body: s.evidence,
            kind: 'sweep',
            meta: [
              { label: 'Swept price', value: String(s.price) },
              { label: 'Bias', value: s.direction },
              { label: 'Reclaimed', value: s.reclaimed ? 'yes' : 'no' },
              { label: 'Level type', value: s.level_kind },
            ],
          },
        });
      }
    }
    if (l.icebergs) {
      for (const ice of a.markers.icebergs || []) {
        markerHits.push({
          time: ice.time, price: ice.price,
          detail: {
            title: ice.label,
            subtitle: `Probable iceberg · ${ice.evidence_count} refresh events`,
            body: `${ice.evidence} This is a heuristic, not a confirmation.`,
            kind: 'iceberg',
            meta: [
              { label: 'Price', value: String(ice.price) },
              { label: 'Side', value: ice.side },
              { label: 'Fill multiple', value: `${ice.fill_multiple}x` },
              { label: 'Confidence', value: `${Math.round(ice.confidence * 100)}%` },
            ],
          },
        });
      }
    }
    if (l.quantumShift) {
      for (const s of a.markers.shifts || []) {
        markerHits.push({
          time: s.time, price: s.price,
          detail: {
            title: s.label,
            subtitle: `Momentum shift \u00b7 confidence ${Math.round((s.score || 0) * 100)}%`,
            body: s.reason,
            kind: 'shift',
            meta: [
              { label: 'Price', value: String(s.price) },
              { label: 'Direction', value: s.direction },
            ],
          },
        });
      }
    }
    if (l.zones) {
      for (const z of (a.zones as any[]) || []) {
        markerHits.push({
          time: 0, price: (z.low + z.high) / 2,
          detail: {
            title: z.label,
            subtitle: 'Supply / demand zone',
            body: z.detail,
            kind: 'zone',
            meta: [{ label: 'Range', value: `${z.low} – ${z.high}` }, { label: 'Type', value: z.kind }],
          },
        });
      }
    }
    hitsRef.current = [...markerHits, ...others];
  }

  // ------------------------------------------- volume profile + bubble map
  // Both layers are drawn on one canvas sized to the price pane. Coordinates
  // come from the chart's own scales, so they stay inside the plot as it pans,
  // zooms and resizes rather than being pinned to a guessed offset.
  const PROFILE_COLORS = {
    dark: { inValue: 'rgba(240, 164, 34, 0.40)', outside: 'rgba(240, 164, 34, 0.18)', poc: 'rgba(255, 199, 102, 0.85)' },
    light: { inValue: 'rgba(148, 87, 0, 0.34)', outside: 'rgba(148, 87, 0, 0.15)', poc: 'rgba(120, 70, 0, 0.75)' },
  };
  const BUBBLE_RGB = {
    dark: { buy: '52, 196, 111', sell: '242, 85, 109' },
    light: { buy: '17, 107, 52', sell: '189, 28, 64' },
  };

  function drawVolume() {
    const canvas = vpRef.current;
    const chart = chartRef.current;
    const candle = candleRef.current;
    const host = hostRef.current;
    if (!canvas || !chart || !candle || !host) return;
    const right = chart.priceScale('right').width();
    const bottom = chart.timeScale().height();
    const width = Math.max(1, Math.round(host.clientWidth - right));
    const height = Math.max(1, Math.round(host.clientHeight - bottom));
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const rows = (analysisRef.current?.series?.candles || []) as any[];
    if (!rows.length) return;
    if (layersRef.current.volumeProfile) drawProfiles(ctx, width, height, rows);
    if (layersRef.current.bubbleMap) drawBubbles(ctx, width, height, rows);
  }

  function drawProfiles(ctx: CanvasRenderingContext2D, w: number, h: number, rows: any[]) {
    const chart = chartRef.current;
    const candle = candleRef.current;
    const profiles = (analysisRef.current?.volume_profiles || []) as any[];
    if (!chart || !candle || !profiles.length) return;
    const scale = chart.timeScale();
    const colors = PROFILE_COLORS[themeRef.current];

    for (const prof of profiles) {
      const bins: number[] = prof?.bins || [];
      const lows: number[] = prof?.buckets_low || [];
      if (!bins.length || bins.length !== lows.length || !(prof.step > 0)) continue;
      const xStart = scale.timeToCoordinate(prof.start_ts as UTCTimestamp);
      const xEnd = scale.timeToCoordinate(prof.end_ts as UTCTimestamp);
      if (xStart === null || xEnd === null) continue;
      if (xEnd < -4 || xStart > w + 4) continue;

      // Aggregate price bins into whole pixel rows before drawing. A session can
      // carry several hundred bins over a couple of hundred pixels, and drawing
      // them one by one paints a solid block instead of a profile.
      const rowVolume = new Map<number, number>();
      for (let k = 0; k < bins.length; k++) {
        const v = bins[k];
        if (!(v > 0)) continue;
        const yLow = candle.priceToCoordinate(lows[k]);
        const yHigh = candle.priceToCoordinate(lows[k] + prof.step);
        if (yLow === null || yHigh === null) continue;
        const y = Math.round((yLow + yHigh) / 2);
        if (y < -2 || y > h + 2) continue;
        rowVolume.set(y, (rowVolume.get(y) ?? 0) + v);
      }
      let maxRow = 0;
      rowVolume.forEach((v) => { if (v > maxRow) maxRow = v; });
      if (maxRow <= 0) continue;

      const anchor = Math.min(w - 2, Math.max(2, xEnd));
      const span = Math.max(1, anchor - Math.max(0, xStart));
      const maxWidth = Math.max(22, Math.min(58, span * 0.32));
      const yPoc = candle.priceToCoordinate(prof.poc);
      const yVah = candle.priceToCoordinate(prof.vah);
      const yVal = candle.priceToCoordinate(prof.val);
      const vaTop = yVah !== null && yVal !== null ? Math.min(yVah, yVal) : null;
      const vaBottom = yVah !== null && yVal !== null ? Math.max(yVah, yVal) : null;

      rowVolume.forEach((volume, y) => {
        const barWidth = (volume / maxRow) * maxWidth;
        if (barWidth < 0.8) return;
        const inValue = vaTop !== null && vaBottom !== null && y >= vaTop - 1 && y <= vaBottom + 1;
        const atPoc = yPoc !== null && Math.abs(y - yPoc) <= 1;
        ctx.fillStyle = atPoc ? colors.poc : inValue ? colors.inValue : colors.outside;
        ctx.fillRect(anchor - barWidth, y - 0.6, barWidth, 1.4);
      });
    }
  }

  function drawBubbles(ctx: CanvasRenderingContext2D, w: number, h: number, rows: any[]) {
    const chart = chartRef.current;
    const candle = candleRef.current;
    if (!chart || !candle) return;
    const scale = chart.timeScale();
    const rgb = BUBBLE_RGB[themeRef.current];

    type Row = { row: any; x: number; yHigh: number; yLow: number; bins: number };
    const visible: Row[] = [];
    let maxPerBin = 0;
    for (const row of rows) {
      const x = scale.timeToCoordinate(row.time as UTCTimestamp);
      if (x === null || x < -10 || x > w + 10) continue;
      const yHigh = candle.priceToCoordinate(row.high);
      const yLow = candle.priceToCoordinate(row.low);
      if (yHigh === null || yLow === null) continue;
      const pixels = Math.abs(yLow - yHigh);
      if (pixels < 2) continue;
      // one bubble per ~7px of the bar's range, so zoomed-in bars split into
      // more price levels and zoomed-out bars stay a single dot
      const bins = Math.max(1, Math.min(16, Math.round(pixels / 7)));
      const perBin = Number(row.volume || 0) / bins;
      if (perBin > maxPerBin) maxPerBin = perBin;
      visible.push({ row, x, yHigh, yLow, bins });
    }
    if (maxPerBin <= 0 || visible.length === 0) return;

    const spacing = visible.length > 1
      ? Math.abs(visible[visible.length - 1].x - visible[0].x) / Math.max(1, visible.length - 1)
      : 8;
    const maxRadius = Math.max(3, Math.min(14, spacing * 1.5));

    for (const item of visible) {
      const { row, x, yHigh, yLow, bins } = item;
      const high = Number(row.high), low = Number(row.low), close = Number(row.close);
      const span = high - low;
      // same close-inside-the-range split the backend uses for delta_proxy
      const skew = span > 0 ? (2 * close - high - low) / span : 0;
      const perBin = Number(row.volume || 0) / bins;
      const weight = Math.min(1, perBin / maxPerBin);
      if (weight < 0.10) continue; // quiet bars drop out, so the big prints are what shows
      const radius = Math.max(1.6, Math.sqrt(weight) * maxRadius);
      const alpha = 0.32 + 0.45 * weight * Math.min(1, Math.abs(skew) + 0.3);
      const top = Math.min(yHigh, yLow);
      const step = Math.abs(yLow - yHigh) / bins;
      const fill = `rgba(${skew >= 0 ? rgb.buy : rgb.sell}, ${alpha.toFixed(3)})`;
      for (let k = 0; k < bins; k++) {
        const y = top + step * (k + 0.5);
        if (y < -radius || y > h + radius) continue;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();
      }
    }
  }

  // ------------------------------------------------------------- interactions
  function handleClick(param: any) {
    const candle = candleRef.current;
    if (!candle || !param.point) return;
    const price = candle.coordinateToPrice(param.point.y);
    if (price === null || price === undefined) return;
    const clickTime = typeof param.time === 'number' ? param.time : 0;
    const a = analysisRef.current;
    const atr = Number(a?.context?.indicators?.atr || 1);
    const tolerance = Math.max(atr * 0.28, Number(a?.spec?.tick_size || 0.25) * 6);
    const hits = hitsRef.current;
    let best: { hit: any; score: number } | null = null;
    for (const hit of hits) {
      const dp = Math.abs(hit.price - price);
      if (dp > tolerance) continue;
      const timePenalty = hit.time && clickTime ? Math.min(1, Math.abs(hit.time - clickTime) / 900) : 0;
      const score = dp / tolerance + timePenalty * 0.4;
      if (!best || score < best.score) best = { hit, score };
    }
    if (!best) {
      setTooltip(null);
      onSelect(null);
      return;
    }
    setTooltip({ x: param.point.x, y: param.point.y, detail: best.hit.detail });
    onSelect(best.hit.detail);
  }

  const bars = (analysis?.series?.candles || []).length;
  return (
    <div className="chart-shell">
      {/* the canvas is a picture: give it a text alternative and make it a
          keyboard stop so it sits in the tab order between the layers menu and
          the decision rail */}
      <div
        ref={hostRef}
        className="chart-host"
        tabIndex={0}
        role="img"
        aria-label={`${analysis?.name || analysis?.symbol || 'Price'} ${analysis?.timeframe_label || ''} candlestick chart, ${bars} bars, with volume profile and volume bubbles. Level, VWAP and marker lines are drawn on the chart and listed in the decision rail.`}
      />
      <canvas ref={vpRef} className="vp-canvas" aria-hidden="true" />
      {tooltip && (
        <div
          className="chart-tooltip"
          style={{
            left: Math.min(tooltip.x + 14, (hostRef.current?.clientWidth || 600) - 310),
            top: Math.max(8, tooltip.y - 20),
          }}
        >
          <b>{tooltip.detail.title}</b>
          {tooltip.detail.subtitle && <div style={{ color: 'var(--faint)', fontSize: 10.5 }}>{tooltip.detail.subtitle}</div>}
          <div className="why" style={{ marginTop: 4 }}>{tooltip.detail.body}</div>
        </div>
      )}
    </div>
  );
}
