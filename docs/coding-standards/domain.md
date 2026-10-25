# Domain

Scope: `src/domain/`. Purity (no database, no clock) is in `docs/agents/rules.md`.

- Return a discriminated union on `ok` from a yes/no decision with reasons.
  Example: `src/domain/freezes.ts`. A domain word may be the discriminant where
  it carries meaning (`result: 'granted' | 'denied'` in `access-rules.ts`).
- Throw a built-in `TypeError` or `RangeError` for a bad argument, and a named
  `Error` subclass for anything a caller is expected to catch. Example:
  `CurrencyMismatchError` in `src/domain/money.ts`.
- Declare each value list once, here, as an `as const` array or a string-literal
  union; `src/db/schema.ts` imports it for its enum. Example: `CURRENCIES` in
  `src/domain/money.ts`. Lint rejects `enum`.
- Describe object shapes with an `interface` of `readonly` fields.
- Export named `function` declarations; default exports only where Next requires
  them.
