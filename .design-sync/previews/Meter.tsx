import { Meter } from 'beefcake-ui';

const rows = [
  { name: 'Spinning 45, Mon 06:30', rate: 0.92, tone: 'good' as const },
  { name: 'Yoga flow, Mon 18:00', rate: 0.68, tone: 'info' as const },
  { name: 'Kettlebells, Tue 12:00', rate: 0.35, tone: 'warn' as const },
];

export const FillRates = () => (
  <div className="w-full max-w-md space-y-3">
    {rows.map((row) => (
      <div key={row.name} className="flex items-center gap-3">
        <span className="w-48 truncate">{row.name}</span>
        <div className="flex-1">
          <Meter value={row.rate} tone={row.tone} />
        </div>
        <span className="w-10 text-right tabular-nums text-ink-muted">{Math.round(row.rate * 100)} %</span>
      </div>
    ))}
  </div>
);

export const Tones = () => (
  <div className="w-full max-w-md space-y-3">
    <Meter value={0.5} tone="neutral" />
    <Meter value={0.9} tone="good" />
    <Meter value={0.6} tone="info" />
    <Meter value={0.35} tone="warn" />
    <Meter value={0.15} tone="bad" />
  </div>
);
