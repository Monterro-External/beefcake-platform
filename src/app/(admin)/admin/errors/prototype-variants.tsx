'use client';

/**
 * PROTOTYPE (BCPLA-50), throwaway. Three variants of the Errors timeseries on
 * /admin/errors, switched with ?variant=A|B|C. They share the Variant C layout
 * from the design and differ on the questions that design left open:
 *
 *   A  linear axis, click a legend row to focus it (axis rescales), history start as a hatched band
 *   B  log axis so small series stay readable, history start as a labelled rule
 *   C  linear axis plus a sparkline per legend row at its own scale, history start as a caption
 *
 * The categorical palette is the dataviz reference palette, hardcoded: the token
 * set has no series colours yet (a token gap the Spec has to close).
 */

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Badge, Card, EmptyState, Field, Select, TD, TH, THead, TR, Table } from '@/components/ui';

const SERIES_COLOURS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const OTHER_COLOUR = 'var(--color-ink-muted)';

export interface ProtoSeries {
  key: string;
  label: string;
  mono: boolean;
  total: number;
  spread: number;
  lastSeen: string;
  values: number[];
  drawn: boolean;
}

export interface ProtoProps {
  variant: 'A' | 'B' | 'C';
  group: 'module' | 'tenant';
  tenant: string | null;
  module: string | null;
  range: string;
  bucketLabels: string[];
  series: ProtoSeries[];
  other: { label: string; count: number; values: number[] } | null;
  historyIndex: number | null; // first bucket with recorded history, when inside the range
  historyFrom: string | null;
  tenants: { id: string; name: string }[];
  modules: string[];
  unitLabel: string;
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function useParamSetter() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
}

function Controls(props: ProtoProps) {
  const set = useParamSetter();
  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-5">
      <Field label="Show one series per">
        <Select className="w-full" value={props.group} onChange={(e) => set('group', e.target.value)}>
          <option value="module">Module</option>
          <option value="tenant">Tenant</option>
        </Select>
      </Field>
      <Field label="Tenant">
        <Select className="w-full" value={props.tenant ?? ''} onChange={(e) => set('tenant', e.target.value)}>
          <option value="">All tenants</option>
          {props.tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Module">
        <Select className="w-full" value={props.module ?? ''} onChange={(e) => set('module', e.target.value)}>
          <option value="">All modules</option>
          {props.modules.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Range">
        <Select className="w-full" value={props.range} onChange={(e) => set('range', e.target.value)}>
          {['1d', '1w', '1m', '6m', '1y'].map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Prototype: history starts on">
        <input
          type="date"
          className="w-full rounded border border-line bg-surface-raised px-2 py-1.5"
          value={props.historyFrom ?? ''}
          onChange={(e) => set('historyFrom', e.target.value)}
        />
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The chart
// ---------------------------------------------------------------------------

const W = 1000;
const H = 260;
const PAD = { l: 48, r: 170, t: 16, b: 28 };

type Scale = 'linear' | 'log';

function niceMax(v: number) {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

function LineChart({
  props,
  lines,
  scale,
  focus,
  historyStyle,
}: {
  props: ProtoProps;
  lines: { key: string; label: string; values: number[]; colour: string; faded?: boolean; mono: boolean }[];
  scale: Scale;
  focus: string | null;
  historyStyle: 'band' | 'rule' | 'none';
}) {
  const [hover, setHover] = useState<number | null>(null);
  const n = props.bucketLabels.length;
  const x = (i: number) => PAD.l + (n === 1 ? 0 : (i * (W - PAD.l - PAD.r)) / (n - 1));
  const hist = props.historyIndex;

  const scaled = focus === null ? lines : lines.filter((l) => l.key === focus);
  const rawMax = Math.max(1, ...scaled.flatMap((l) => l.values.filter((_, i) => hist === null || i >= hist)));
  const max = scale === 'linear' ? niceMax(rawMax) : 10 ** Math.ceil(Math.log10(rawMax + 1));
  const y = (v: number) => {
    const t = scale === 'linear' ? v / max : Math.log10(v + 1) / Math.log10(max + 1);
    return H - PAD.b - Math.min(1, t) * (H - PAD.t - PAD.b);
  };
  const ticks =
    scale === 'linear'
      ? [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * max))
      : [0, 1, 10, 100, 1000, 10000].filter((t) => t <= max);
  const labelEvery = Math.ceil(n / 9);

  const path = (values: number[], from: number, to: number) =>
    values
      .slice(from, to + 1)
      .map((v, k) => `${k === 0 ? 'M' : 'L'}${x(from + k).toFixed(1)},${y(v).toFixed(1)}`)
      .join(' ');

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Errors over time">
        <defs>
          <pattern id="no-history" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="8" style={{ stroke: 'var(--color-line)', strokeWidth: 2 }} />
          </pattern>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} style={{ stroke: 'var(--color-line-soft)' }} />
            <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" style={{ fontSize: 11, fill: 'var(--color-ink-muted)' }}>
              {t}
            </text>
          </g>
        ))}
        {props.bucketLabels.map((label, i) =>
          (i % labelEvery === 0 && n - 1 - i >= labelEvery) || i === n - 1 ? (
            <text key={i} x={x(i)} y={H - 8} textAnchor="middle" style={{ fontSize: 11, fill: 'var(--color-ink-muted)' }}>
              {i === n - 1 ? `${label} (so far)` : label}
            </text>
          ) : null,
        )}

        {hist !== null && historyStyle === 'band' && (
          <g>
            <rect x={PAD.l} y={PAD.t} width={Math.max(0, x(hist) - PAD.l)} height={H - PAD.t - PAD.b} fill="url(#no-history)" opacity={0.6} />
            <text x={PAD.l + 6} y={PAD.t + 14} style={{ fontSize: 11, fill: 'var(--color-ink)' }}>
              No recorded history
            </text>
          </g>
        )}
        {hist !== null && historyStyle === 'rule' && (
          <g>
            <line x1={x(hist)} x2={x(hist)} y1={PAD.t} y2={H - PAD.b} style={{ stroke: 'var(--color-ink)', strokeDasharray: '4 3' }} />
            <text x={x(hist) + 6} y={PAD.t + 12} style={{ fontSize: 11, fill: 'var(--color-ink)' }}>
              Recorded history starts {props.historyFrom}
            </text>
          </g>
        )}

        {lines.map((line) => {
          const from = hist ?? 0;
          const solidTo = Math.max(from, n - 2);
          const opacity = line.faded ? 0.2 : 1;
          return (
            <g key={line.key} opacity={opacity}>
              {n - 1 > from && (
                <path d={path(line.values, from, solidTo)} style={{ fill: 'none', stroke: line.colour, strokeWidth: 2 }} />
              )}
              <path
                d={path(line.values, Math.max(from, n - 2), n - 1)}
                style={{ fill: 'none', stroke: line.colour, strokeWidth: 2, strokeDasharray: '5 4' }}
              />
              {!line.faded && (
                <text
                  x={W - PAD.r + 8}
                  y={y(line.values[n - 1] ?? 0) + 4}
                  style={{ fontSize: 11, fill: 'var(--color-ink)', fontFamily: line.mono ? 'var(--font-mono)' : undefined }}
                >
                  {line.label.length > 24 ? `${line.label.slice(0, 23)}…` : line.label}
                </text>
              )}
            </g>
          );
        })}

        {hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} style={{ stroke: 'var(--color-ink-muted)' }} />
        )}
        {props.bucketLabels.map((_, i) => (
          <rect
            key={i}
            x={x(i) - (W - PAD.l - PAD.r) / Math.max(1, n - 1) / 2}
            y={PAD.t}
            width={(W - PAD.l - PAD.r) / Math.max(1, n - 1)}
            height={H - PAD.t - PAD.b}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-2 rounded border border-line bg-surface-raised px-3 py-2 text-xs shadow"
          style={{ left: `${Math.min(70, (x(hover) / W) * 100)}%` }}
        >
          <p className="mb-1 font-medium">
            {props.bucketLabels[hover]}
            {hover === n - 1 ? ' (so far)' : ''}
          </p>
          {hist !== null && hover < hist ? (
            <p className="text-ink-muted">No recorded history</p>
          ) : (
            lines
              .filter((l) => !l.faded)
              .map((l) => (
                <p key={l.key} className="flex items-center gap-2">
                  <span className="inline-block h-0.5 w-3" style={{ background: l.colour }} />
                  <span className={l.mono ? 'font-mono' : undefined}>{l.label}</span>
                  <span className="ml-auto pl-3 tabular-nums">{l.values[hover]}</span>
                </p>
              ))
          )}
        </div>
      )}
    </div>
  );
}

function Sparkline({ values, colour, from }: { values: number[]; colour: string; from: number }) {
  const w = 120;
  const h = 24;
  const max = Math.max(1, ...values);
  const n = values.length;
  const d = values
    .slice(from)
    .map((v, k) => `${k === 0 ? 'M' : 'L'}${(((from + k) * w) / Math.max(1, n - 1)).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`)
    .join(' ');
  return (
    <svg width={w} height={h} aria-hidden="true">
      <path d={d} style={{ fill: 'none', stroke: colour, strokeWidth: 1.5 }} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Legend table
// ---------------------------------------------------------------------------

function shapeBadge(spread: number) {
  if (spread === 1) return <Badge tone="warn">One tenant</Badge>;
  if (spread >= 5) return <Badge tone="bad">Fleet wide</Badge>;
  return <Badge tone="info">Several</Badge>;
}

function Legend({
  props,
  colourOf,
  focus,
  onFocus,
  sparklines,
}: {
  props: ProtoProps;
  colourOf: (key: string) => string;
  focus: string | null;
  onFocus?: (key: string | null) => void;
  sparklines: boolean;
}) {
  const byModule = props.group === 'module';
  return (
    <Card title={`Series, ${props.range}${onFocus ? ' (click a row to focus it)' : ''}`}>
      <Table>
        <THead>
          <TR>
            <TH>{byModule ? 'Module' : 'Tenant'}</TH>
            {sparklines && <TH>Trend, own scale</TH>}
            <TH align="right">Errors</TH>
            <TH align="right">{byModule ? 'Tenants affected' : 'Modules involved'}</TH>
            {byModule && <TH>Shape</TH>}
            <TH>Last seen</TH>
          </TR>
        </THead>
        <tbody>
          {props.series.map((s) => (
            <TR
              key={s.key}
              className={onFocus ? 'cursor-pointer' : undefined}
              {...(onFocus ? { onClick: () => onFocus(focus === s.key ? null : s.key) } : {})}
            >
              <TD mono={s.mono}>
                <span className="mr-2 inline-block h-0.5 w-3 align-middle" style={{ background: s.drawn ? colourOf(s.key) : OTHER_COLOUR }} />
                <span className={focus === s.key ? 'font-semibold' : undefined}>{s.label}</span>
                {!s.drawn && <span className="ml-2 text-ink-muted">in "{props.other?.label}"</span>}
              </TD>
              {sparklines && (
                <TD>
                  <Sparkline values={s.values} colour={s.drawn ? colourOf(s.key) : OTHER_COLOUR} from={props.historyIndex ?? 0} />
                </TD>
              )}
              <TD align="right">{s.total}</TD>
              <TD align="right">{s.spread}</TD>
              {byModule && <TD>{shapeBadge(s.spread)}</TD>}
              <TD className="whitespace-nowrap text-ink-muted">{s.lastSeen}</TD>
            </TR>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

export function ErrorsTimeseriesPrototype(props: ProtoProps) {
  const [focus, setFocus] = useState<string | null>(null);
  const drawnKeys = props.series.filter((s) => s.drawn).map((s) => s.key);
  const colourOf = (key: string) => SERIES_COLOURS[drawnKeys.indexOf(key)] ?? OTHER_COLOUR;

  const lines = [
    ...props.series
      .filter((s) => s.drawn)
      .map((s) => ({
        key: s.key,
        label: s.label,
        values: s.values,
        colour: colourOf(s.key),
        mono: s.mono,
        faded: props.variant === 'A' && focus !== null && focus !== s.key,
      })),
    ...(props.other === null
      ? []
      : [
          {
            key: '__other__',
            label: `${props.other.label} (${props.other.count})`,
            values: props.other.values,
            colour: OTHER_COLOUR,
            mono: false,
            faded: props.variant === 'A' && focus !== null,
          },
        ]),
  ];

  const title = `Errors per ${props.unitLabel} by ${props.group}, last ${props.range}, Stockholm time`;

  return (
    <>
      <Controls {...props} />
      <Card title={title}>
        {props.series.length === 0 ? (
          <EmptyState title="Nothing logged in this range" />
        ) : (
          <>
            {props.variant === 'C' && props.historyIndex !== null && (
              <p className="mb-2 text-ink-muted">
                Recorded history starts {props.historyFrom}. Earlier {props.unitLabel}s have no data, which is not the same as zero errors.
              </p>
            )}
            <LineChart
              props={props}
              lines={lines}
              scale={props.variant === 'B' ? 'log' : 'linear'}
              focus={props.variant === 'A' ? focus : null}
              historyStyle={props.variant === 'A' ? 'band' : props.variant === 'B' ? 'rule' : 'none'}
            />
            {props.variant === 'B' && <p className="mt-2 text-ink-muted">Log scale: each gridline is ten times the one below.</p>}
          </>
        )}
      </Card>
      <div className="mt-4">
        <Legend
          props={props}
          colourOf={colourOf}
          focus={props.variant === 'A' ? focus : null}
          {...(props.variant === 'A' ? { onFocus: setFocus } : {})}
          sparklines={props.variant === 'C'}
        />
      </div>
    </>
  );
}
