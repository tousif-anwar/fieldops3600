import type { Layers } from '../types';

interface Props {
  layers: Layers;
  onChange: (next: Layers) => void;
  capabilities: any;
}

const ROWS: Array<{ key: keyof Layers; label: string; needs?: 'trades' | 'depth' }> = [
  { key: 'levels', label: 'Key levels' },
  { key: 'pivots', label: 'Floor pivots' },
  { key: 'valueArea', label: 'POC / VAH / VAL' },
  { key: 'vwap', label: 'VWAP + bands' },
  { key: 'emas', label: 'EMA 9/21/50/200' },
  { key: 'supertrend', label: 'SuperTrend' },
  { key: 'swings', label: 'Swing points' },
  { key: 'structure', label: 'BOS / CHoCH' },
  { key: 'quantumShift', label: 'Quantum shift' },
  { key: 'sweeps', label: 'Liquidity sweeps' },
  { key: 'zones', label: 'Supply / demand zones' },
  { key: 'icebergs', label: 'Probable icebergs', needs: 'depth' },
  { key: 'signals', label: 'Signal levels' },
  { key: 'volumeProfile', label: 'Volume profile' },
  { key: 'bubbleMap', label: 'Volume bubbles' },
  { key: 'volume', label: 'Volume pane' },
];

export default function LayerToggles({ layers, onChange, capabilities }: Props) {
  return (
    <details className="layers">
      <summary>
        <span>Layers</span>
        <span style={{ color: 'var(--accent)' }}>{ROWS.filter((r) => layers[r.key]).length}</span>
      </summary>
      <div className="layer-list">
        {ROWS.map((row) => {
          const available = !row.needs || Boolean(capabilities?.[row.needs]);
          return (
            <label key={row.key} className={`layer-row ${available ? '' : 'disabled'}`}
                   title={available ? '' : `needs ${row.needs} data`}>
              <input
                type="checkbox"
                checked={Boolean(layers[row.key]) && available}
                disabled={!available}
                onChange={(e) => onChange({ ...layers, [row.key]: e.target.checked })}
              />
              {row.label}
              {!available && <span style={{ marginLeft: 'auto', fontSize: 9 }}>no data</span>}
            </label>
          );
        })}
      </div>
    </details>
  );
}
