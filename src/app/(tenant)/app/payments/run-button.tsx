'use client';

/**
 * Run the payment run now. Owners only, and deliberately a two-step: the button
 * asks before it charges several thousand people.
 */

import { useState, useTransition } from 'react';
import { Button, Callout } from '@/components/ui';
import { runPaymentsNow } from '@/app/actions/payments';
import type { ActionResult } from '@/app/actions/subscriptions';

export function RunPaymentsButton({ period }: { period: string }) {
  const [pending, startTransition] = useTransition();
  const [armed, setArmed] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);

  if (result !== null) {
    return (
      <div className="max-w-md">
        <Callout tone={result.ok ? 'good' : 'bad'}>{result.message}</Callout>
      </div>
    );
  }

  if (!armed) {
    return (
      <Button variant="primary" onClick={() => setArmed(true)}>
        Run payments for {period}
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-ink-muted">Charge every billable member for {period}?</span>
      <Button
        variant="primary"
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            setResult(await runPaymentsNow());
          });
        }}
      >
        {pending ? 'Running...' : 'Yes, run it'}
      </Button>
      <Button onClick={() => setArmed(false)} disabled={pending}>
        Cancel
      </Button>
    </div>
  );
}
