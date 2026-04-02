'use client';

/**
 * The four things front desk does to a membership, in the order they come up at
 * the counter: freeze it, change the plan, give notice, block the member.
 *
 * Each one calls a server action and shows exactly what the server said, rather
 * than optimistically claiming success. The wording of a rejection comes from
 * the server too, because the rule that rejected it lives there.
 */

import { useState, useTransition } from 'react';
import { Badge, Button, Callout, Card, Field, Input, Select } from '@/components/ui';
import {
  type ActionResult,
  cancelFreeze,
  cancelSubscription,
  changePlan,
  freezeSubscription,
  setMemberStatus,
  withdrawCancellation,
} from '@/app/actions/subscriptions';

interface PlanOption {
  id: string;
  name: string;
  label: string;
  current: boolean;
}

const CANCEL_REASONS = [
  { value: 'moving', label: 'Moving away' },
  { value: 'too_expensive', label: 'Too expensive' },
  { value: 'not_using', label: 'Not using it' },
  { value: 'other_gym', label: 'Going to another gym' },
  { value: 'health', label: 'Health' },
  { value: 'other', label: 'Other' },
];

const FREEZE_REASONS = [
  { value: 'travel', label: 'Travel' },
  { value: 'injury', label: 'Injury' },
  { value: 'parental_leave', label: 'Parental leave' },
  { value: 'work', label: 'Work' },
  { value: 'other', label: 'Other' },
];

export function MembershipActions({
  subscriptionId,
  memberId,
  memberStatus,
  today,
  noticePeriodDays,
  maxFreezeMonths,
  hasNotice,
  plans,
  activeFreezeId,
}: {
  subscriptionId: string;
  memberId: string;
  memberStatus: 'active' | 'blocked' | 'former';
  today: string;
  noticePeriodDays: number;
  maxFreezeMonths: number;
  hasNotice: boolean;
  plans: PlanOption[];
  activeFreezeId: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  const [freezeStart, setFreezeStart] = useState(today);
  const [freezeMonths, setFreezeMonths] = useState(1);
  const [freezeReason, setFreezeReason] = useState('travel');
  const [targetPlan, setTargetPlan] = useState(plans.find((plan) => !plan.current)?.id ?? '');
  const [cancelReason, setCancelReason] = useState('not_using');

  function run(action: () => Promise<ActionResult>): void {
    startTransition(async () => {
      setResult(await action());
    });
  }

  return (
    <Card title="Front desk">
      {result !== null && (
        <div className="mb-3">
          <Callout tone={result.ok ? 'good' : 'bad'}>{result.message}</Callout>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <section>
          <h3 className="mb-2 font-medium">Freeze</h3>
          {activeFreezeId !== null ? (
            <>
              <p className="mb-2 text-ink-muted">
                <Badge tone="info">Frozen now</Badge> Removing the freeze restores access after
                tonight&apos;s sync.
              </p>
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => run(() => cancelFreeze(activeFreezeId))}
              >
                Remove freeze
              </Button>
            </>
          ) : (
            <div className="space-y-2">
              <Field label="From">
                <Input
                  type="date"
                  value={freezeStart}
                  min={today}
                  onChange={(event) => setFreezeStart(event.target.value)}
                />
              </Field>
              <Field label="Months" hint={`This operator allows up to ${maxFreezeMonths}.`}>
                <Select
                  className="w-full"
                  value={String(freezeMonths)}
                  onChange={(event) => setFreezeMonths(Number.parseInt(event.target.value, 10))}
                >
                  {Array.from({ length: maxFreezeMonths }, (_, i) => i + 1).map((months) => (
                    <option key={months} value={months}>
                      {months} {months === 1 ? 'month' : 'months'}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Reason">
                <Select
                  className="w-full"
                  value={freezeReason}
                  onChange={(event) => setFreezeReason(event.target.value)}
                >
                  {FREEZE_REASONS.map((reason) => (
                    <option key={reason.value} value={reason.value}>
                      {reason.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                variant="primary"
                disabled={pending}
                onClick={() =>
                  run(() => freezeSubscription(subscriptionId, freezeStart, freezeMonths, freezeReason))
                }
              >
                Freeze membership
              </Button>
            </div>
          )}
        </section>

        <section>
          <h3 className="mb-2 font-medium">Change plan</h3>
          <div className="space-y-2">
            <Field
              label="New plan"
              hint="A downgrade is blocked while the member is inside a binding period."
            >
              <Select
                className="w-full"
                value={targetPlan}
                onChange={(event) => setTargetPlan(event.target.value)}
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
              disabled={pending || targetPlan === ''}
              onClick={() => run(() => changePlan(subscriptionId, targetPlan))}
            >
              Move to plan
            </Button>
            <p className="text-ink-muted">
              The change takes effect today. Both plans are charged pro rata for their part of this
              period.
            </p>
          </div>
        </section>

        <section>
          <h3 className="mb-2 font-medium">{hasNotice ? 'Notice' : 'Cancel'}</h3>
          {hasNotice ? (
            <>
              <p className="mb-2 text-ink-muted">
                Notice has been given. Taking it back keeps the membership running unchanged.
              </p>
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => run(() => withdrawCancellation(subscriptionId))}
              >
                Withdraw notice
              </Button>
            </>
          ) : (
            <div className="space-y-2">
              <Field label="Reason" hint={`Notice period is ${noticePeriodDays} days.`}>
                <Select
                  className="w-full"
                  value={cancelReason}
                  onChange={(event) => setCancelReason(event.target.value)}
                >
                  {CANCEL_REASONS.map((reason) => (
                    <option key={reason.value} value={reason.value}>
                      {reason.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                variant="danger"
                disabled={pending}
                onClick={() => run(() => cancelSubscription(subscriptionId, cancelReason))}
              >
                Give notice
              </Button>
              <p className="text-ink-muted">
                Offer a freeze first. It is what most people actually want, and they come back.
              </p>
            </div>
          )}

          <hr className="my-4 border-line" />
          <h3 className="mb-2 font-medium">Card</h3>
          {memberStatus === 'blocked' ? (
            <Button variant="secondary" disabled={pending} onClick={() => run(() => setMemberStatus(memberId, 'active'))}>
              Unblock member
            </Button>
          ) : (
            <Button variant="danger" disabled={pending} onClick={() => run(() => setMemberStatus(memberId, 'blocked'))}>
              Block card
            </Button>
          )}
        </section>
      </div>
    </Card>
  );
}
