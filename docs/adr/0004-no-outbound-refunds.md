# 4. Downgrades produce credit, not refunds

- Status: accepted
- Date: 2025-10-20
- Deciders: Tobias Ek, Sara Lindqvist

## Context

A member who moves from Premium to Bas in the middle of a period is owed the
difference for the remaining days. Paying it back means an outbound payment: a
credit transfer for Autogiro and AvtaleGiro, a card refund for the others. Each
has its own file format, its own failure modes, its own reconciliation, and in
the Autogiro case a mandate that only authorises debits.

Typical amounts are between 30 and 200 kr.

## Decision

Proration for a downgrade nets negative and is carried as credit against the
member's next charge. We do not send money out.

`proratePlanChange` returns a negative `net` for a downgrade, and the payment run
applies any outstanding credit before charging. A member who leaves with credit
outstanding is settled at the front desk, which is a cash or card operation the
operator already performs daily.

## Consequences

Good:

- No outbound payment integration, no credit-transfer file, no refund
  reconciliation. The provider interface only has to charge.
- Fewer moving parts on the path that touches money.

Bad:

- A member who downgrades and then cancels immediately has to be handled by the
  operator rather than by us. Support has a runbook for it.
- Credit sitting on an account is a liability we report but do not pay interest
  on. Finance signed this off; revisit if the amounts stop being small.
