# Issue tracker: Linear

Issues and specs for this repo live in Linear, team **Beefcake-platform**, key
`BCPLA` (team id `fc9ba842-25f8-45a1-9750-0acce3b06c8c`). Product Tickets live in
a separate team, **Beefcake-product**, key `BCPRO` (team id
`2bbac6b3-8328-4054-8342-a9dac07e9dab`); this repo reads them and links to them
but never creates or moves them. All operations go through the
Linear MCP tools, not a CLI. Their schemas are deferred: load them with
ToolSearch (e.g. `select:mcp__claude_ai_Linear__get_issue,...`) before calling.

## Conventions

- **Create an issue**: `save_issue` with `team: "Beefcake-platform"`, a title, and a
  markdown `description`. One issue per ticket, never a combined tickets doc.
- **Read an issue**: `get_issue` with the identifier (`BCPLA-123`, or `BCPRO-123` for a Product Ticket), then
  `list_comments` for the thread.
- **List issues**: `list_issues` with `team: "Beefcake-platform"` plus state / label /
  assignee filters.
- **Comment**: `save_comment` with the issue id.
- **Labels**: `save_issue` with `labels`. Labels are per-team; enumerate with
  `list_issue_labels` `team: "Beefcake-platform"` before applying, so you reuse an
  existing label instead of creating a near-duplicate.
- **Close**: `save_issue` with a terminal state (`Done`, `Canceled`).
- Tickets are referred to by identifier (`BCPLA-123`) everywhere, in commits too.

## Existing vocabulary

Type labels: `Bug`, `Improvement`, `Feature`, `Initiative`. Also
`support-escalation`, and `internal-admin` under the `area` group. Use these;
don't introduce a parallel type taxonomy.

## When a skill says "publish to the issue tracker"

Create a Linear issue in team Beefcake-platform. The Spec is the parent issue,
one per change: the spec content is its description, and its first line links
back to the originating Product Ticket (`BCPRO-nnn`) in Beefcake-product. The
implementation tickets are its sub-issues (`parentId` set to the Spec issue),
each naming the requirement IDs it implements. Never a separate Linear document
and never a combined tickets doc. This is the artifact chain in
`standards/product-ticket-standard.md` and `standards/handover-artifact-standard.md`
in the workshop repo.

## When a skill says "fetch the relevant ticket"

`get_issue` on the identifier, plus `list_comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a parent issue; **children** are sub-issues.

- **Map**: an issue in team Beefcake-platform holding the Notes / Decisions-so-far / Fog
  body, labelled `wayfinder:map` (create the label on first use).
- **Child ticket**: `save_issue` with `parentId` set to the map's id. Type is a
  `wayfinder:<type>` label (`research`/`prototype`/`grilling`/`task`).
- **Blocking**: Linear's native blocked-by relation where the MCP exposes it;
  otherwise a `Blocked by: BCPLA-nn, BCPLA-nn` line at the top of the description. A
  ticket is unblocked when every blocker is `Done` or `Canceled`.
- **Frontier**: `list_issues` filtered to the map's children, open states, no
  assignee; first in creation order wins.
- **Claim**: assign to yourself (`save_issue` with your `assigneeId`, from
  `get_user`), the session's first write.
- **Resolve**: `save_comment` with the answer, set state `Done`, then append a
  context pointer (gist + link) to the map's Decisions-so-far.
