# 8. Three surfaces in one application

- Status: accepted
- Date: 2025-09-01
- Deciders: Sara Lindqvist, Nour Haddad

## Context

We ship to three audiences: gym operators, their members, and our own support
and CS team. They share almost all of their domain logic and almost none of
their screens.

The alternatives were three deployables, or one deployable with three route
groups.

## Decision

One Next.js application, three route groups:

| Path | Audience |
|---|---|
| `/app` | Operators: owner, site manager, front desk |
| `/me` | Members |
| `/admin` | Beefcake staff |

They share `src/domain/`, `src/db/` and `src/integrations/`. They share nothing
in `src/app/`. Authorisation is by role, and the admin surface is the only one
that gets an `AdminScope`.

## Consequences

Good:

- One deploy, one migration, one set of domain tests. A change to proration
  cannot be live on one surface and not another.
- Impersonation is a scope narrowing rather than a cross-service call.

Bad:

- The member app ships the operator app's server code. Nothing is exposed by
  that, since authorisation is checked per request, but it is a larger blast
  radius than three services would have.
- A member-facing incident and an operator-facing incident are the same
  deployable. If the member app ever needs a different availability target, this
  is the decision to revisit.
