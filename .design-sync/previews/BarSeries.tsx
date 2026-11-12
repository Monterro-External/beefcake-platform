import { BarSeries, Card } from 'beefcake-ui';

const kr = (minor: number) => `${Math.round(minor / 100000)}k`;

export const RevenueWithFailures = () => (
  <Card title="Revenue, last 6 months (SEK)">
    <BarSeries
      format={kr}
      bars={[
        { label: 'Jun', value: 51200000, secondary: 2900000 },
        { label: 'Jul', value: 47800000, secondary: 3400000 },
        { label: 'Aug', value: 52900000, secondary: 2600000 },
        { label: 'Sep', value: 56100000, secondary: 3100000 },
        { label: 'Oct', value: 57400000, secondary: 2400000 },
        { label: 'Nov', value: 58300000, secondary: 3700000 },
      ]}
    />
  </Card>
);

export const SingleSeries = () => (
  <Card title="Check-ins per month">
    <BarSeries
      format={(n) => String(n)}
      bars={[
        { label: 'Jun', value: 8120 },
        { label: 'Jul', value: 6930 },
        { label: 'Aug', value: 8840 },
        { label: 'Sep', value: 10210 },
        { label: 'Oct', value: 10870 },
        { label: 'Nov', value: 9480 },
      ]}
    />
  </Card>
);
