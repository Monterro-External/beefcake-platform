import { Button, Field, Input, Select } from 'beefcake-ui';

export const FreezeForm = () => (
  <div className="w-full max-w-md space-y-3">
    <div className="grid grid-cols-2 gap-3">
      <Field label="From">
        <Input type="date" defaultValue="2026-12-01" />
      </Field>
      <Field label="For">
        <Select className="w-full" defaultValue="1">
          <option value="1">1 month</option>
          <option value="2">2 months</option>
          <option value="3">3 months</option>
        </Select>
      </Field>
    </div>
    <div className="flex justify-end">
      <Button variant="primary">Freeze membership</Button>
    </div>
  </div>
);

export const WithHint = () => (
  <div className="w-full max-w-sm">
    <Field label="Retry interval (days)" hint="Applies from the next payment run. Fallback is 3, 7, 14.">
      <Input defaultValue="3, 7, 14" />
    </Field>
  </div>
);
