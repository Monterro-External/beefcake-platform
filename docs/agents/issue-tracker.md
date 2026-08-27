# Issue tracker: Linear

Issues and specs for this repo live in Linear, team **Beefcake**, key `BC`
(team id `2bbac6b3-8328-4054-8342-a9dac07e9dab`). All operations go through the
Linear MCP tools, not a CLI. Their schemas are deferred: load them with
ToolSearch (e.g. `select:mcp__claude_ai_Linear__get_issue,...`) before calling.

## Conventions

- **Create an issue**: `save_issue` with `team: "Beefcake"`, a title, and a
  markdown `description`. One issue per ticket, never a combined tickets doc.
- **Read an issue**: `get_issue` with the identifier (`BC-123`), then
  `list_comments` for the thread.
- **List issues**: `list_issues` with `team: "Beefcake"` plus state / label /
  assignee filters.
- **Comment**: `save_comment` with the issue id.
- **Labels**: `save_issue` with `labels`. Labels are per-team; enumerate with
  `list_issue_labels` `team: "Beefcake"` before applying, so you reuse an
  existing label instead of creating a near-duplicate.
- **Close**: `save_issue` with a terminal state (`Done`, `Canceled`).
- Tickets are referred to by identifier (`BC-123`) everywhere, in commits too.

## Existing vocabulary

Type labels: `Bug`, `Improvement`, `Feature`, `Initiative`. Also
`support-escalation`, and `internal-admin` under the `area` group. Use these;
don't introduce a parallel type taxonomy.

## When a skill says "publish to the issue tracker"

Create a Linear issue in team Beefcake. A feature spec goes in the parent
issue's description, or a Linear document (`save_document`) linked from it, with
implementation tickets as sub-issues.

## When a skill says "fetch the relevant ticket"

`get_issue` on the identifier, plus `list_comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a parent issue; **children** are sub-issues.

- **Map**: an issue in team Beefcake holding the Notes / Decisions-so-far / Fog
  body, labelled `wayfinder:map` (create the label on first use).
- **Child ticket**: `save_issue` with `parentId` set to the map's id. Type is a
  `wayfinder:<type>` label (`research`/`prototype`/`grilling`/`task`).
- **Blocking**: Linear's native blocked-by relation where the MCP exposes it;
  otherwise a `Blocked by: BC-nn, BC-nn` line at the top of the description. A
  ticket is unblocked when every blocker is `Done` or `Canceled`.
- **Frontier**: `list_issues` filtered to the map's children, open states, no
  assignee; first in creation order wins.
- **Claim**: assign to yourself (`save_issue` with your `assigneeId`, from
  `get_user`), the session's first write.
- **Resolve**: `save_comment` with the answer, set state `Done`, then append a
  context pointer (gist + link) to the map's Decisions-so-far.
