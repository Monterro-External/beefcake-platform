# 3. Tenant settings in a key-value table

- Status: accepted
- Date: 2025-10-02
- Deciders: Elin Sandberg, Nour Haddad

## Context

Operators want different notice periods, different retry policies, different
freeze limits, and they want them changed while they are on the phone to
support. Modelling each of those as a column on `tenants` means a migration per
setting and a deploy before support can help anyone.

## Decision

One table, `tenant_settings (tenant_id, key, value, updated_at)`, with `value`
stored as text.

The cost of that flexibility is concentrated in one file:
`src/domain/tenant-settings.ts`. It is the only place that knows what a key
means, what type its value has and what it falls back to when a tenant has never
set it. Everything reads settings through `readSettings()`, which returns a fully
populated, typed object.

## Consequences

Good:

- A new setting is one entry in `SETTING_KEYS`, one field on `TenantSettings`,
  one default, and support can change it per tenant immediately.
- Every default is in one list, so "what does a tenant who has never touched
  this get" has one answer.

Bad:

- No database-level typing. A hand-written `retry_attempts = 'three'` is
  possible; `readSettings` falls back to the default rather than producing `NaN`,
  and there is a test for that.
- The blast radius of a wrong default is the whole fleet. Most tenants override
  nothing, so a changed default reaches everyone at once. This is why
  `DEFAULT_SETTINGS` is on the "talk to someone first" list in `docs/agents/rules.md`.
- Reading raw rows and coercing at the call site would reintroduce every problem
  this decision was meant to solve. Do not do it.
