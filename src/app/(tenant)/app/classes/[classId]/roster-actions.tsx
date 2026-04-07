'use client';

/**
 * Marking attendance. Two buttons, because that is the whole interaction: the
 * instructor walks the room with a tablet after the class has started.
 */

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui';
import { markAttendance } from '@/app/actions/bookings';

export function RosterActions({
  bookingId,
  status,
  inThePast,
}: {
  bookingId: string;
  status: 'booked' | 'attended' | 'no_show';
  inThePast: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [current, setCurrent] = useState(status);

  if (!inThePast) {
    return <span className="text-ink-muted">not yet</span>;
  }

  function mark(next: 'attended' | 'no_show'): void {
    startTransition(async () => {
      const result = await markAttendance(bookingId, next);
      if (result.ok) setCurrent(next);
    });
  }

  return (
    <div className="flex justify-end gap-1">
      <Button
        variant={current === 'attended' ? 'primary' : 'secondary'}
        disabled={pending}
        onClick={() => mark('attended')}
      >
        Here
      </Button>
      <Button
        variant={current === 'no_show' ? 'danger' : 'secondary'}
        disabled={pending}
        onClick={() => mark('no_show')}
      >
        No show
      </Button>
    </div>
  );
}
