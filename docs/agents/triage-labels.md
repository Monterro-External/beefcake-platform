# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.

## Status in this workspace

All five labels exist in the Beefcake team, under a `triage` label **group**.
Linear enforces one label per group per issue, so applying `ready-for-agent`
removes `needs-triage` on its own: never try to clear the previous state by
hand, and never expect an issue to carry two triage labels at once.

Apply them by name (`save_issue` with `labels: ["ready-for-agent"]`); the group
is a Linear-side constraint and the skills never name it. The team's other
labels sit outside the group and are unaffected: `Bug`, `Improvement`,
`Feature`, `Initiative`, `support-escalation`, and `internal-admin` under `area`.

Linear's own Triage inbox and workflow states overlap with `needs-triage` and
`needs-info`. The labels above are the source of truth for the skills, so if you
also move issues through Linear states, keep the label in step or the two will
disagree.
