# 2. Money as integer minor units with an explicit currency

- Status: accepted
- Date: 2025-09-15
- Deciders: Tobias Ek, Sara Lindqvist

## Context

We bill in four currencies and take a percentage of everything we process. A
199,00 kr plan charged to 22,000 members has to reconcile to the öre against the
provider's settlement file, and a mid-month plan change means dividing a monthly
price by 31 and multiplying it back.

The failure modes we had already seen elsewhere:

- Floats. `0.1 + 0.2` is not `0.3`, and a month of rounding drift turns into a
  finance ticket nobody can close.
- Decimal strings with implicit currency. Two amounts add up fine and the result
  is meaningless, because one was NOK and one was SEK.
- Rounding chosen by whatever the language does by default, differing between
  the invoice line and the reconciliation report.

## Decision

`src/domain/money.ts` defines `Money` as an integer count of minor units plus a
`Currency`, and it is the only way amounts move through the system.

- Every amount carries its currency. Combining two currencies throws; it never
  coerces.
- Every operation that can produce a fraction takes an explicit rounding mode.
  There is no default.
- Dividing an amount into parts uses `allocate()`, which hands out the remainder
  one unit at a time so the parts always sum back to the whole.
- Proration uses `prorate(amount, numerator, denominator, rounding)`, which keeps
  the arithmetic in integers until the final rounding step.
- Display currency comes from the amount, never from the reader's locale.

In the database every amount is an integer column with a currency column beside
it. There is no bare `amount` column anywhere.

## Consequences

Good:

- Totals reconcile exactly. A period's charges sum to the payment run total with
  no tolerance.
- A currency mistake is a type error or an exception, not a wrong number.
- The rounding rule for any given line is written down at the call site.

Bad:

- More verbose than a plain number. `add(a, b)` instead of `a + b`.
- Currencies with a different minor-unit exponent (ISK has none, JOD has three)
  would need `MINOR_UNITS_PER_MAJOR` to be honoured everywhere it currently
  happens to be 100. We sell in four currencies that all use 100 and will revisit
  this if that changes.
