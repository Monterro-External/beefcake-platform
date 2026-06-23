'use client';

import { useTransition } from 'react';
import { Button } from '@/components/ui';
import { startImpersonation } from '@/app/actions/session';

export function ImpersonateButton({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="primary"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          await startImpersonation(tenantId);
        });
      }}
      title={`Open ${tenantName} read-only. This is logged.`}
    >
      {pending ? 'Opening...' : 'Open read-only'}
    </Button>
  );
}
