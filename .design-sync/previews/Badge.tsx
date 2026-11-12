import { Badge } from 'beefcake-ui';

export const Tones = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Badge>Paused</Badge>
    <Badge tone="good">Active</Badge>
    <Badge tone="warn">Retrying</Badge>
    <Badge tone="bad">Abandoned</Badge>
    <Badge tone="info">Frozen</Badge>
  </div>
);

export const InContext = () => (
  <div className="flex items-center gap-3">
    <span className="font-semibold">Anna Lindqvist</span>
    <Badge tone="warn">Read-only, impersonating</Badge>
  </div>
);
