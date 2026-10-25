# Pages and route handlers

Scope: `page.tsx`, `layout.tsx` and `route.ts` under `src/app/`.

- Read through repositories, or `src/export/reports.ts` for a report. Server
  actions are for writes.
- Get the scope with `tenantScopeFor(await getSession())`.
- Narrow Beefcake staff to one tenant with `impersonate(admin, tenantId)`, so the
  scope keeps the staff actor. Example: `src/lib/session.ts`. A batch CLI with no
  person behind it (the signal export) builds
  `tenantScope(id, { db, actorRole: 'system' })`, like a job.
- Show money and dates through `src/lib/format`, passing `tenant.locale`.
- Return route-handler errors as `NextResponse.json({ error, hint? }, { status })`
  and send files with `cache-control: no-store`. Example:
  `src/app/(tenant)/app/reports/export/[report]/route.ts`.
