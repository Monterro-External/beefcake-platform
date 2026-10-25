# Server actions

Scope: `src/app/actions/`.

- Take typed positional arguments and return `Promise<ActionResult>`
  (`{ ok, message }`). Example: `src/app/actions/settings.ts`.
- Return `{ ok: false, message }` for anything a user can cause: bad input, a
  missing permission, a disabled feature. Throw only for a state that means a
  bug. No caller catches and there is no error boundary, so a throw never
  reaches the user.
- Check a `PERMISSIONS` key in every action, member self-service (`self.book`,
  `self.subscription`) and staff-only actions included. Example:
  `src/app/actions/settings.ts`.
- Validate every input at runtime at the top of the action.
- Write the message as a full sentence that states the consequence: "Frozen
  from 1 March to 31 March. Back on 1 April."
- After a write, call `revalidatePath(<surface>, 'layout')`.
- Call an action from the client with `useTransition` and local state, and show
  the result in a `Callout`. Example: `src/app/(tenant)/app/members/new/form.tsx`.
- Orchestrate in the action or the job; there is no service layer. Pass
  dependencies on context objects (`JobContext`, `TenantScope`), not a container.
