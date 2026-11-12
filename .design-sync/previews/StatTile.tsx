import { StatTile } from 'beefcake-ui';

export const Overview = () => (
  <div className="grid grid-cols-3 gap-3">
    <StatTile label="Active members" value="1 284" hint="46 joined, 19 left in 30 days" />
    <StatTile label="Failed on last run" value="6,3 %" tone="warn" hint="79 of 1 250 charges" />
    <StatTile label="Class fill, 30 days" value="78 %" tone="good" hint="Across 412 classes" />
  </div>
);

export const Tones = () => (
  <div className="grid grid-cols-4 gap-3">
    <StatTile label="Neutral" value="312" />
    <StatTile label="Good" value="91 %" tone="good" />
    <StatTile label="Warn" value="6,3 %" tone="warn" />
    <StatTile label="Bad" value="11,2 %" tone="bad" />
  </div>
);
