'use client';

/**
 * One button per class. What it says depends on where the member stands: book,
 * join the waitlist, or cancel. The result message comes from the server, so a
 * class that filled up between render and click says so honestly.
 */

import { useState, useTransition } from 'react';
import { Badge, Button } from '@/components/ui';
import { bookClass, cancelBooking } from '@/app/actions/bookings';

export function BookButton({
  classId,
  memberId,
  bookingId,
  state,
  position,
  disabled,
}: {
  classId: string;
  memberId: string;
  bookingId: string | null;
  state: 'free' | 'full' | 'booked' | 'waitlisted';
  position: number | null;
  disabled: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<{ ok: boolean; message: string }>): void {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.message);
    });
  }

  if (error !== null) {
    return <span className="text-bad">{error}</span>;
  }

  if (state === 'booked' || state === 'waitlisted') {
    return (
      <div className="flex items-center justify-end gap-2">
        {state === 'waitlisted' ? (
          <Badge tone="warn">Waiting{position === null ? '' : ` #${position}`}</Badge>
        ) : (
          <Badge tone="good">Booked</Badge>
        )}
        <Button
          variant="ghost"
          disabled={pending || bookingId === null}
          onClick={() => run(() => cancelBooking(bookingId as string))}
        >
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <Button
      variant={state === 'free' ? 'primary' : 'secondary'}
      disabled={pending || disabled}
      onClick={() => run(() => bookClass(classId, memberId))}
    >
      {state === 'free' ? 'Book' : 'Join waitlist'}
    </Button>
  );
}
