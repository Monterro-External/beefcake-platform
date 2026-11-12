import { Field, Input } from 'beefcake-ui';

export const Text = () => (
  <div className="w-full max-w-sm">
    <Input placeholder="Search by name, email or card number" />
  </div>
);

export const Filled = () => (
  <div className="grid w-full max-w-md grid-cols-2 gap-3">
    <Field label="Email">
      <Input type="email" defaultValue="anna.lindqvist@example.se" />
    </Field>
    <Field label="From">
      <Input type="date" defaultValue="2026-12-01" />
    </Field>
  </div>
);
