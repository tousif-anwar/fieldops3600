export type Analysis = any;
export type SignalCard = any;

export interface Market {
  symbol: string;
  name: string;
  exchange: string;
  code: string;
  expiry: string;
  dollars_per_point: number;
  tick_size: number;
  tick_value: number;
  margin: number;
  available: boolean;
  sector: string;
}

export interface Layers {
  levels: boolean;
  pivots: boolean;
  valueArea: boolean;
  vwap: boolean;
  emas: boolean;
  supertrend: boolean;
  swings: boolean;
  structure: boolean;
  quantumShift: boolean;
  sweeps: boolean;
  zones: boolean;
  icebergs: boolean;
  signals: boolean;
  volumeProfile: boolean;
  bubbleMap: boolean;
  volume: boolean;
}

export const DEFAULT_LAYERS: Layers = {
  levels: true,
  pivots: true,
  valueArea: true,
  vwap: true,
  emas: true,
  supertrend: true,
  swings: false,
  structure: true,
  quantumShift: true,
  sweeps: true,
  zones: true,
  icebergs: true,
  signals: true,
  volumeProfile: true,
  bubbleMap: true,
  volume: true,
};

export interface Detail {
  title: string;
  subtitle?: string;
  body: string;
  meta?: Array<{ label: string; value: string }>;
  kind: string;
}
