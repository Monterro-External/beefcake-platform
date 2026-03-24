'use client';

import { useTransition } from 'react';
import { Button } from '@/components/ui';
import { stopImpersonation } from '@/app/actions/session';

export function StopImpersonating() {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="secondary"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          await stopImpersonation();
        });
      }}
    >
      Stop
    </Button>
  );
}
