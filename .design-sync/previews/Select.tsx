import { Field, Select } from 'beefcake-ui';

export const Default = () => (
  <Select defaultValue="all">
    <option value="all">All sites</option>
    <option value="sodermalm">Södermalm</option>
    <option value="kungsholmen">Kungsholmen</option>
  </Select>
);

export const InField = () => (
  <div className="w-full max-w-xs">
    <Field label="For">
      <Select className="w-full" defaultValue="2">
        <option value="1">1 month</option>
        <option value="2">2 months</option>
        <option value="3">3 months</option>
      </Select>
    </Field>
  </div>
);
