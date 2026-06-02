'use client';

/**
 * Self-serve freeze, plan change and cancellation. Same server actions as the
 * front desk, same domain rules, so a member cannot talk the software into
 * something a member of staff could not.
 */

import { useState, useTransition } from 'react';
import { Button, Callout, Card, Field, Input, Select } from '@/components/ui';
import {
  type ActionResult,
  cancelFreeze,
  cancelSubscription,
  changePlan,
  freezeSubscription,
  withdrawCancellation,
} from '@/app/actions/subscriptions';

export function SelfServePanel({
  subscriptionId,
  today,
  maxFreezeMonths,
  noticePeriodDays,
  hasNotice,
  activeFreezeId,
  plans,
}: {
  subscriptionId: string;
  today: string;
  maxFreezeMonths: number;
  noticePeriodDays: number;
  hasNotice: boolean;
  activeFreezeId: string | null;
  plans: { id: string; label: string; current: boolean }[];
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [start, setStart] = useState(today);
  const [months, setMonths] = useState(1);
  const [target, setTarget] = useState(plans.find((plan) => !plan.current)?.id ?? '');
  const [reason, setReason] = useState('not_using');

  function run(action: () => Promise<ActionResult>): void {
    startTransition(async () => {
      setResult(await action());
    });
  }

  return (
    <Card title="Make a change">
      {result !== null && (
        <div className="mb-3">
          <Callout tone={result.ok ? 'good' : 'bad'}>{result.message}</Callout>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <section>
          <h3 className="mb-2 font-medium">Freeze</h3>
          {activeFreezeId !== null ? (
            <Button disabled={pending} onClick={() => run(() => cancelFreeze(activeFreezeId))}>
              End my freeze early
            </Button>
          ) : (
            <div className="space-y-2">
              <Field label="From">
                <Input
                  type="date"
                  value={start}
                  min={today}
                  onChange={(event) => setStart(event.target.value)}
                />
              </Field>
              <Field label="For">
                <Select
                  className="w-full"
                  value={String(months)}
                  onChange={(event) => setMonths(Number.parseInt(event.target.value, 10))}
                >
                  {Array.from({ length: maxFreezeMonths }, (_, i) => i + 1).map((option) => (
                    <option key={option} value={option}>
                      {option} {option === 1 ? 'month' : 'months'}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                variant="primary"
                disabled={pending}
                onClick={() => run(() => freezeSubscription(subscriptionId, start, months, 'other'))}
              >
                Freeze
              </Button>
              <p className="text-ink-muted">
                You are not billed while frozen, and your binding period is pushed out by the same
                time.
              </p>
            </div>
          )}
        </section>

        <section>
          <h3 className="mb-2 font-medium">Change plan</h3>
          <div className="space-y-2">
            <Field label="Move to">
              <Select
                className="w-full"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
              >
                {plans
                  .filter((plan) => !plan.current)
                  .map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.label}
                    </option>
                  ))}
              </Select>
            </Field>
            <Button
              variant="primary"
              disabled={pending || target === ''}
              onClick={() => run(() => changePlan(subscriptionId, target))}
            >
              Change plan
            </Button>
            <p className="text-ink-muted">
              Takes effect today. You pay each plan for the days you were on it.
            </p>
          </div>
        </section>

        <section>
          <h3 className="mb-2 font-medium">Cancel</h3>
          {hasNotice ? (
            <Button disabled={pending} onClick={() => run(() => withdrawCancellation(subscriptionId))}>
              I want to stay after all
            </Button>
          ) : (
            <div className="space-y-2">
              <Field label="Why are you leaving?" hint={`Notice period is ${noticePeriodDays} days.`}>
                <Select
                  className="w-full"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                >
                  <option value="moving">Moving away</option>
                  <option value="too_expensive">Too expensive</option>
                  <option value="not_using">Not using it</option>
                  <option value="other_gym">Going to another gym</option>
                  <option value="health">Health</option>
                  <option value="other">Other</option>
                </Select>
              </Field>
              <Button
                variant="danger"
                disabled={pending}
                onClick={() => run(() => cancelSubscription(subscriptionId, reason))}
              >
                Cancel my membership
              </Button>
              <p className="text-ink-muted">
                A freeze keeps your membership and your binding period. Consider that first.
              </p>
            </div>
          )}
        </section>
      </div>
    </Card>
  );
}
