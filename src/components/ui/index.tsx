/**
 * The component set.
 *
 * Small on purpose. Beefcake is a tool people use for eight hours a day at a
 * front desk: dense tables, high contrast, no animation, nothing that moves
 * while you are reading it. Anything fancier than what is here needs a reason.
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/cn';

// ---------------------------------------------------------------------------
// Page furniture
// ---------------------------------------------------------------------------

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle !== undefined && <p className="mt-0.5 text-ink-muted">{subtitle}</p>}
      </div>
      {actions !== undefined && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Card({
  title,
  actions,
  children,
  className,
  footer,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  footer?: ReactNode;
}) {
  return (
    <section className={cn('rounded border border-line bg-surface-raised', className)}>
      {(title !== undefined || actions !== undefined) && (
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{title}</h2>
          {actions}
        </div>
      )}
      <div className="px-4 py-3">{children}</div>
      {footer !== undefined && (
        <div className="border-t border-line px-4 py-2 text-ink-muted">{footer}</div>
      )}
    </section>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="py-8 text-center">
      <p className="font-medium">{title}</p>
      {hint !== undefined && <p className="mt-1 text-ink-muted">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="-mx-4 overflow-x-auto">
      <table className={cn('w-full min-w-full text-left align-middle', className)}>{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-muted">{children}</thead>;
}

export function TR({
  children,
  className,
  ...rest
}: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn('border-b border-line/60 last:border-0', className)} {...rest}>
      {children}
    </tr>
  );
}

export function TH({
  children,
  align = 'left',
  className,
}: {
  children?: ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn('px-4 py-2 font-medium', align === 'right' && 'text-right', className)}
    >
      {children}
    </th>
  );
}

export function TD({
  children,
  align = 'left',
  className,
  mono,
  title,
  colSpan,
}: {
  children?: ReactNode;
  align?: 'left' | 'right';
  className?: string;
  mono?: boolean;
  /** Tooltip, for cells that truncate. */
  title?: string;
  colSpan?: number;
}) {
  return (
    <td
      title={title}
      colSpan={colSpan}
      className={cn(
        'px-4 py-2',
        align === 'right' && 'text-right',
        mono === true && 'font-mono text-[13px]',
        className,
      )}
    >
      {children}
    </td>
  );
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info';

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-line/50 text-ink',
  good: 'bg-good/12 text-good',
  warn: 'bg-warn/15 text-warn',
  bad: 'bg-bad/12 text-bad',
  info: 'bg-accent-soft text-accent',
};

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="rounded border border-line bg-surface-raised px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <p
        className={cn(
          'mt-1 text-2xl font-semibold tabular-nums tracking-tight',
          tone === 'bad' && 'text-bad',
          tone === 'warn' && 'text-warn',
          tone === 'good' && 'text-good',
        )}
      >
        {value}
      </p>
      {hint !== undefined && <p className="mt-0.5 text-ink-muted">{hint}</p>}
    </div>
  );
}

export function DefinitionList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5">
      {items.map((item) => (
        <div key={item.label} className="col-span-2 grid grid-cols-subgrid">
          <dt className="text-ink-muted">{item.label}</dt>
          <dd className="text-right tabular-nums">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A horizontal bar for a 0-1 value. Used for fill rates and health components,
 * where the number matters and the shape is a glance.
 */
export function Meter({ value, tone = 'info' }: { value: number; tone?: Tone }) {
  const clamped = Math.min(1, Math.max(0, value));
  const fill: Record<Tone, string> = {
    neutral: 'bg-ink-muted',
    good: 'bg-good',
    warn: 'bg-warn',
    bad: 'bg-bad',
    info: 'bg-accent',
  };
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-line"
      role="meter"
      aria-valuenow={Math.round(clamped * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={cn('h-full rounded-full', fill[tone])} style={{ width: `${clamped * 100}%` }} />
    </div>
  );
}

/** A monthly series as a bar chart. Deliberately plain; no library. */
export function BarSeries({
  bars,
  format,
}: {
  bars: { label: string; value: number; secondary?: number }[];
  format: (value: number) => string;
}) {
  const max = Math.max(1, ...bars.map((bar) => bar.value + (bar.secondary ?? 0)));
  return (
    <div className="flex items-end gap-1.5 overflow-x-auto pb-1" style={{ minHeight: '9rem' }}>
      {bars.map((bar) => (
        <div key={bar.label} className="flex min-w-9 flex-1 flex-col items-center gap-1">
          <span className="text-[11px] tabular-nums text-ink-muted">{format(bar.value)}</span>
          <div className="flex h-24 w-full flex-col justify-end">
            {bar.secondary !== undefined && bar.secondary > 0 && (
              <div
                className="w-full rounded-t bg-bad/60"
                style={{ height: `${(bar.secondary / max) * 100}%` }}
                title={`${format(bar.secondary)} failed`}
              />
            )}
            <div
              className={cn('w-full bg-accent', bar.secondary === undefined && 'rounded-t')}
              style={{ height: `${(bar.value / max) * 100}%` }}
            />
          </div>
          <span className="text-[11px] whitespace-nowrap text-ink-muted">{bar.label}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

const BUTTON_VARIANTS = {
  primary: 'bg-accent text-white hover:opacity-90',
  secondary: 'border border-line bg-surface-raised hover:bg-accent-soft',
  danger: 'border border-bad/40 text-bad hover:bg-bad/8',
  ghost: 'hover:bg-accent-soft',
} as const;

export function Button({
  children,
  variant = 'secondary',
  type = 'button',
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTON_VARIANTS }) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded px-2.5 py-1.5 font-medium',
        'disabled:cursor-not-allowed disabled:opacity-50',
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  children,
  variant = 'secondary',
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: keyof typeof BUTTON_VARIANTS;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded px-2.5 py-1.5 font-medium',
        BUTTON_VARIANTS[variant],
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function Input({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'w-full rounded border border-line bg-surface-raised px-2.5 py-1.5',
        'focus:border-accent focus:outline-none',
        className,
      )}
      {...rest}
    />
  );
}

export function Select({
  className,
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'rounded border border-line bg-surface-raised px-2 py-1.5',
        'focus:border-accent focus:outline-none',
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </span>
      {children}
      {hint !== undefined && <span className="mt-1 block text-ink-muted">{hint}</span>}
    </label>
  );
}

export function Tabs({
  tabs,
  active,
}: {
  tabs: { href: string; label: string; count?: number }[];
  active: string;
}) {
  return (
    <nav className="mb-4 flex gap-1 border-b border-line">
      {tabs.map((tab) => {
        const isActive = tab.href === active;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 font-medium',
              isActive
                ? 'border-accent text-accent'
                : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className="ml-1.5 tabular-nums text-ink-muted">{tab.count}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function Pagination({
  basePath,
  page,
  pageSize,
  total,
  query = {},
}: {
  basePath: string;
  page: number;
  pageSize: number;
  total: number;
  query?: Record<string, string | undefined>;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (target: number): string => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params.set(key, value);
    }
    if (target > 1) params.set('page', String(target));
    const search = params.toString();
    return search === '' ? basePath : `${basePath}?${search}`;
  };

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <div className="flex items-center justify-between gap-4">
      <p className="text-ink-muted tabular-nums">
        {from}-{to} of {total}
      </p>
      <div className="flex gap-1">
        {page > 1 && (
          <LinkButton href={href(page - 1)} variant="secondary">
            Previous
          </LinkButton>
        )}
        {page < pages && (
          <LinkButton href={href(page + 1)} variant="secondary">
            Next
          </LinkButton>
        )}
      </div>
    </div>
  );
}

export function Callout({
  tone = 'info',
  title,
  children,
}: {
  tone?: Tone;
  title?: string;
  children: ReactNode;
}) {
  const border: Record<Tone, string> = {
    neutral: 'border-line bg-surface-raised',
    good: 'border-good/30 bg-good/6',
    warn: 'border-warn/40 bg-warn/8',
    bad: 'border-bad/30 bg-bad/6',
    info: 'border-accent/30 bg-accent-soft',
  };
  return (
    <div className={cn('rounded border px-3 py-2', border[tone])}>
      {title !== undefined && <p className="font-medium">{title}</p>}
      <div className={cn(title !== undefined && 'mt-0.5')}>{children}</div>
    </div>
  );
}
