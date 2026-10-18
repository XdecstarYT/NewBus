import { useMemo, useState } from 'react';
import { formatBits } from '@dw/shared';

/** Tiny dependency-free SVG charts. */
export function Sparkline({ values, height = 40, color = 'rgb(var(--accent))', className = '' }: { values: number[]; height?: number; color?: string; className?: string }) {
  const w = 300;
  if (values.length < 2) return <div className={`text-xs muted ${className}`}>Not enough data yet.</div>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${height - ((v - min) / span) * (height - 4) - 2}`).join(' ');
  const up = values[values.length - 1] >= values[0];
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className={`w-full ${className}`} preserveAspectRatio="none" role="img" aria-label={`Trend from ${values[0]} to ${values[values.length - 1]}`}>
      <polyline points={`0,${height} ${pts} ${w},${height}`} fill={up ? 'rgb(var(--good) / 0.12)' : 'rgb(var(--bad) / 0.12)'} stroke="none" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export interface Candle {
  bucket: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** Candlestick chart with volume bars and a hover readout. Toggle to line mode. */
export function CandleChart({ candles, height = 260 }: { candles: Candle[]; height?: number }) {
  const [mode, setMode] = useState<'candles' | 'line'>('candles');
  const [hover, setHover] = useState<number | null>(null);
  const w = 640;
  const volH = 50;
  const priceH = height - volH - 10;
  const data = candles.slice(-80);
  const { min, max, vmax } = useMemo(() => {
    const lows = data.map((d) => d.l);
    const highs = data.map((d) => d.h);
    return { min: Math.min(...lows), max: Math.max(...highs), vmax: Math.max(1, ...data.map((d) => d.v)) };
  }, [data]);
  if (data.length < 2) return <div className="text-sm muted p-6 text-center">📉 Waiting for trades to draw the chart...</div>;
  const span = max - min || 1;
  const cw = w / data.length;
  const y = (p: number) => priceH - ((p - min) / span) * (priceH - 10) - 5;
  const hv = hover != null ? data[hover] : data[data.length - 1];
  return (
    <div>
      <div className="flex items-center gap-2 text-xs mb-1 flex-wrap">
        <button className={`chip ${mode === 'candles' ? '!bg-accent !text-white' : ''}`} onClick={() => setMode('candles')}>🕯️ Candles</button>
        <button className={`chip ${mode === 'line' ? '!bg-accent !text-white' : ''}`} onClick={() => setMode('line')}>📈 Line</button>
        <span className="ml-auto font-mono">
          {new Date(hv.bucket).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} O {hv.o} H {hv.h} L {hv.l} C {hv.c} V {hv.v}
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full" onMouseLeave={() => setHover(null)} role="img" aria-label="Price chart">
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={w} y1={priceH * f} y2={priceH * f} stroke="rgb(var(--ink) / 0.08)" />
        ))}
        {mode === 'line' ? (
          <polyline points={data.map((d, i) => `${i * cw + cw / 2},${y(d.c)}`).join(' ')} fill="none" stroke="rgb(var(--accent))" strokeWidth="2.5" />
        ) : (
          data.map((d, i) => {
            const up = d.c >= d.o;
            const col = up ? 'rgb(var(--good))' : 'rgb(var(--bad))';
            const x = i * cw + cw / 2;
            return (
              <g key={d.bucket}>
                <line x1={x} x2={x} y1={y(d.h)} y2={y(d.l)} stroke={col} strokeWidth="1.5" />
                <rect x={x - cw * 0.35} width={Math.max(1, cw * 0.7)} y={y(Math.max(d.o, d.c))} height={Math.max(1.5, Math.abs(y(d.o) - y(d.c)))} fill={col} rx="1" />
              </g>
            );
          })
        )}
        {data.map((d, i) => (
          <rect key={`v${d.bucket}`} x={i * cw + cw * 0.15} width={cw * 0.7} y={height - (d.v / vmax) * volH} height={(d.v / vmax) * volH} fill="rgb(var(--accent) / 0.35)" />
        ))}
        {data.map((d, i) => (
          <rect key={`h${d.bucket}`} x={i * cw} width={cw} y={0} height={height} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
        <text x={w - 4} y={12} textAnchor="end" fontSize="10" fill="rgb(var(--muted))">{max}</text>
        <text x={w - 4} y={priceH - 2} textAnchor="end" fontSize="10" fill="rgb(var(--muted))">{min}</text>
      </svg>
    </div>
  );
}

export function BarList({ items }: { items: Array<{ label: string; value: number; color?: string }> }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="flex flex-col gap-1">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-2 text-sm">
          <span className="w-32 truncate">{it.label}</span>
          <div className="flex-1 h-3 rounded-full bg-ink/10 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${(it.value / max) * 100}%`, background: it.color ?? 'rgb(var(--accent))' }} />
          </div>
          <span className="w-16 text-right tabular-nums font-bold">{formatBits(it.value, false)}</span>
        </div>
      ))}
    </div>
  );
}
