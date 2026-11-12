import { Button } from 'beefcake-ui';

export const Variants = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Button variant="primary">Book class</Button>
    <Button variant="secondary">Export CSV</Button>
    <Button variant="danger">Cancel membership</Button>
    <Button variant="ghost">Skip</Button>
  </div>
);

export const Disabled = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Button variant="primary" disabled>
      Book class
    </Button>
    <Button disabled>End my freeze early</Button>
  </div>
);

export const FormActions = () => (
  <div className="flex items-center justify-end gap-2">
    <Button variant="ghost">Cancel</Button>
    <Button variant="primary" type="submit">
      Save settings
    </Button>
  </div>
);
