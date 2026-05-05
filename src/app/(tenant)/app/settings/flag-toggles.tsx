'use client';

import { useState, useTransition } from 'react';
import { Badge, Button, Callout } from '@/components/ui';
import { setFlag } from '@/app/actions/settings';
import type { ActionResult } from '@/app/actions/subscriptions';

export function FlagToggles({
  flags,
  editable,
}: {
  flags: { key: string; label: string; enabled: boolean; overridden: boolean }[];
  editable: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  return (
    <div className="space-y-2">
      {result !== null && <Callout tone={result.ok ? 'good' : 'bad'}>{result.message}</Callout>}
      {flags.map((flag) => (
        <div key={flag.key} className="flex items-center justify-between gap-3">
          <div>
            <span className="font-medium">{flag.label}</span>
            {!flag.overridden && (
              <>
                {' '}
                <Badge tone="neutral">default</Badge>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={flag.enabled ? 'good' : 'neutral'}>{flag.enabled ? 'On' : 'Off'}</Badge>
            {editable && (
              <Button
                disabled={pending}
                onClick={() => {
                  startTransition(async () => {
                    setResult(await setFlag(flag.key, !flag.enabled));
                  });
                }}
              >
                Turn {flag.enabled ? 'off' : 'on'}
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
