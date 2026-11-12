import { Tabs } from 'beefcake-ui';

export const MemberTabs = () => (
  <div className="w-full">
    <Tabs
      active="/app/members/123/payments"
      tabs={[
        { href: '/app/members/123', label: 'Overview' },
        { href: '/app/members/123/payments', label: 'Payments', count: 14 },
        { href: '/app/members/123/visits', label: 'Visits', count: 132 },
        { href: '/app/members/123/freezes', label: 'Freezes', count: 1 },
      ]}
    />
  </div>
);
