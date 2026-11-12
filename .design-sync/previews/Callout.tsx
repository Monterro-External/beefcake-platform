import { Callout } from 'beefcake-ui';

export const Tones = () => (
  <div className="space-y-3">
    <Callout tone="info" title="Your membership is frozen">
      Back on 1 December 2026. You are not billed while frozen.
    </Callout>
    <Callout tone="warn" title="You have given notice">
      You can train until 31 January 2027. After that your card stops working.
    </Callout>
    <Callout tone="bad" title="This will not open the door right now">
      Your membership has ended. Talk to the front desk to start again.
    </Callout>
    <Callout tone="good">Settings saved. Changes apply from the next payment run.</Callout>
    <Callout tone="neutral" title="Development clock">
      Today is pinned to 12 November 2026 for this environment.
    </Callout>
  </div>
);

export const OperatorWarning = () => (
  <Callout tone="warn" title="4 member(s) have exhausted their retries">
    Every one of these is a cancellation in two to three weeks unless somebody calls them. That
    lag is the single most predictable thing in this data.
  </Callout>
);
