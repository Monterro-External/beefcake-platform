import { Card, EmptyState } from 'beefcake-ui';

export const InCard = () => (
  <Card title="Upcoming classes">
    <EmptyState title="No classes in the next week" hint="The timetable is published a fortnight ahead." />
  </Card>
);

export const TitleOnly = () => (
  <Card title="Freezes">
    <EmptyState title="Never frozen" />
  </Card>
);
