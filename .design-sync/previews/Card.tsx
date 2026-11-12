import { Button, Card, DefinitionList } from 'beefcake-ui';

export const WithTitleAndActions = () => (
  <Card title="Membership" actions={<Button variant="ghost">Change plan</Button>}>
    <DefinitionList
      items={[
        { label: 'Plan', value: 'All sites, monthly' },
        { label: 'Price', value: '449,00 kr / month' },
        { label: 'Next payment', value: '1 Dec 2026' },
      ]}
    />
  </Card>
);

export const WithFooter = () => (
  <Card title="Payment run" footer="Last run 1 Nov 2026, 06:00. Next run 1 Dec 2026.">
    <p>1 212 charges succeeded and 38 failed. Failed charges are retried after 3, 7 and 14 days.</p>
  </Card>
);

export const BodyOnly = () => (
  <Card>
    <p>Bookings open 14 days ahead. A member can hold at most three future bookings.</p>
  </Card>
);
