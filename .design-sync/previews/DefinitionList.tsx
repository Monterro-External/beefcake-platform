import { Card, DefinitionList } from 'beefcake-ui';

export const AccessCard = () => (
  <Card title="Your card">
    <DefinitionList
      items={[
        { label: 'Card', value: '04A2 19F3 7C' },
        { label: 'Home gym', value: 'Södermalm' },
        { label: 'Plan covers', value: 'All sites' },
        { label: 'Door hours', value: '05:00 to 23:00' },
      ]}
    />
  </Card>
);

export const Subscription = () => (
  <Card title="Membership">
    <DefinitionList
      items={[
        { label: 'Plan', value: 'Off-peak, 12 months' },
        { label: 'Price', value: '299,00 kr / month' },
        { label: 'Started', value: '3 Feb 2026' },
        { label: 'Binding until', value: '2 Feb 2027' },
      ]}
    />
  </Card>
);
