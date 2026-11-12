import { LinkButton } from 'beefcake-ui';

export const Variants = () => (
  <div className="flex flex-wrap items-center gap-2">
    <LinkButton href="/app/members/new" variant="primary">
      Add member
    </LinkButton>
    <LinkButton href="/app/reports">Open reports</LinkButton>
    <LinkButton href="/app/members/123/cancel" variant="danger">
      Cancel membership
    </LinkButton>
    <LinkButton href="/app" variant="ghost">
      Back to overview
    </LinkButton>
  </div>
);
