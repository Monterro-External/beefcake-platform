'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Callout, Field, Input, Select } from '@/components/ui';
import { createMember, type CreateMemberResult } from '@/app/actions/subscriptions';

export function NewMemberForm({
  sites,
  plans,
  currentYear,
}: {
  sites: { id: string; name: string }[];
  plans: { id: string; label: string }[];
  currentYear: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<CreateMemberResult | null>(null);
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    birthYear: String(currentYear - 32),
    siteId: sites[0]?.id ?? '',
    planId: plans[0]?.id ?? '',
    issueCard: true,
  });

  const set = (key: keyof typeof form, value: string | boolean): void =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const outcome = await createMember({
            name: form.name,
            email: form.email,
            phone: form.phone,
            birthYear: Number.parseInt(form.birthYear, 10),
            siteId: form.siteId,
            planId: form.planId,
            issueCard: form.issueCard,
          });
          setResult(outcome);
          if (outcome.ok && outcome.memberId !== undefined) {
            router.push(`/app/members/${outcome.memberId}`);
          }
        });
      }}
    >
      {result !== null && <Callout tone={result.ok ? 'good' : 'bad'}>{result.message}</Callout>}

      <Field label="Name">
        <Input
          name="name"
          required
          autoComplete="off"
          value={form.name}
          onChange={(event) => set('name', event.target.value)}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Email">
          <Input
            name="email"
            type="email"
            required
            autoComplete="off"
            value={form.email}
            onChange={(event) => set('email', event.target.value)}
          />
        </Field>
        <Field label="Phone">
          <Input
            name="phone"
            autoComplete="off"
            value={form.phone}
            onChange={(event) => set('phone', event.target.value)}
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Birth year">
          <Input
            name="birthYear"
            type="number"
            min={currentYear - 100}
            max={currentYear - 14}
            value={form.birthYear}
            onChange={(event) => set('birthYear', event.target.value)}
          />
        </Field>
        <Field label="Home gym">
          <Select
            name="siteId"
            className="w-full"
            value={form.siteId}
            onChange={(event) => set('siteId', event.target.value)}
          >
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Plan">
          <Select
            name="planId"
            className="w-full"
            value={form.planId}
            onChange={(event) => set('planId', event.target.value)}
          >
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          name="issueCard"
          checked={form.issueCard}
          onChange={(event) => set('issueCard', event.target.checked)}
        />
        <span>Issue an access card now</span>
      </label>

      <div className="flex items-center gap-2 pt-1">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Signing up...' : 'Sign up'}
        </Button>
        <p className="text-ink-muted">
          The first month is pro-rated from today. Take that amount at the desk.
        </p>
      </div>
    </form>
  );
}
