import { Callout, PageHeader } from '@/components/ui';
import { roleLabel, type Role } from '@/lib/session';

/**
 * What a role that cannot see a screen gets instead. Explicit rather than a
 * redirect: a front desk user who followed a link from the overview should be
 * told why, not silently bounced.
 */
export function NotAllowed({ title, role, what }: { title: string; role: Role; what: string }) {
  return (
    <>
      <PageHeader title={title} />
      <Callout tone="warn" title="Not available to your role">
        {roleLabel(role)} cannot {what}. Ask the owner, or switch role with the persona picker.
      </Callout>
    </>
  );
}
