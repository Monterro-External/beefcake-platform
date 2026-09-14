# Figma design system plan

Goal: a tokenized Figma library for Beefcake, generated from this codebase, that
designers can design new features in and Claude Code can implement from.

Figma folder: https://www.figma.com/files/folder/654165448

Three files, one job each:

| File | Holds | Published? |
|---|---|---|
| [Beefcake token decisions](https://www.figma.com/board/Q5gE0k6BiuC2m1lNRUXtwc) (FigJam) | why each token has the value it has | n/a |
| [Beefcake design system](https://www.figma.com/design/x0pdVJyALuOj9LlnqoXfne) | Foundations and 21 components | yes, as a team library |
| [Beefcake product](https://www.figma.com/design/48dNdG13T00FjfPV21YLZf) | screens, and proposals for gaps | never |

## Where the codebase stands (audit, 2026-09-13)

Better than most. The system already lives in code, it just is not mirrored in Figma.

| Dimension | State |
|---|---|
| Color tokens | 10 semantic tokens in `src/app/globals.css` (`@theme`), oklch. Zero raw hex in `src/`. |
| Type scale | Not tokenized. Body 14px in CSS, Tailwind defaults elsewhere, 5 arbitrary sizes (`text-[10px]`, `[11px]`, `[13px]`). |
| Spacing, radius | Tailwind defaults, not narrowed. Used consistently in practice (gap-2/3/4, px-2.5, py-1.5, `rounded`). |
| Components | 21 primitives in `src/components/ui/index.tsx`. One `Tone` axis (neutral/good/warn/bad/info), Button has 4 variants (primary/secondary/danger/ghost), no size axis. 14 alpha modifiers on semantic colors across 5 components (TR, Badge, BarSeries, Button danger, Callout), which have no Figma variable equivalent. |
| Theming | Light only. |
| Figma | Nothing. |

Design intent is documented in the file headers: dense, high contrast, no
decoration, no animation. The Figma library must carry that, not soften it.

## Steps

### 1. Audit (done, read-only)
Findings above. No files written.

### 2. Rationalize: decision sheet for designers (board created 2026-09-13)
Claude proposes, designers decide. The sheet is a FigJam board in the Figma folder:
https://www.figma.com/board/Q5gE0k6BiuC2m1lNRUXtwc

Eight cards, each with evidence from the code, a recommendation, a confidence
pill, and a teal sticky for the decision (approve / override with value / reject):

1. Type scale: 7 sizes in use, propose 5 named steps (11, 12, 14, 20, 24).
2. Spacing: keep the 4px unit, name the 12 steps in use, add a container token (92rem).
3. Radius: two tokens, 4px and full.
4. Tints: replace the 14 alpha modifiers with explicit tokens (`good-soft`, `bad-soft`, ...).
5. Text on accent: one `on-accent` token replaces `text-white`.
6. Token names: keep the code vocabulary as Figma names, or rename.
7. Button size axis: none in v1 (recommendation), designers confirm.
8. Dark mode: in or out of scope for the first library.

Each card carries five blocks: evidence from the code, a recommendation,
"What it looks like" (values rendered from `globals.css`), "Where it lands"
(components, surfaces, page counts, and whether a pixel changes), and a
numbered list of every decision the card requires. Only cards 1 and 4 change
pixels.

The numbered list is load-bearing. A card whose recommendation buries a choice
in prose ("12 or 14, your call") gets approved without that choice being made,
and step 3 stalls. Every open question belongs in "Your decisions", numbered,
with a matching slot on the sticky.

Impact evidence is tiered so the same step works at a portco where we cannot
run the app:
- Static impact map from the code (always; what the board has now).
- Screenshots of a staging URL, browsed from here (when the portco gives us one).
- A Playwright script listing the affected routes, run by a portco engineer,
  screenshots dropped on the board (when there is no URL).

Gate: no step 3 until every numbered decision has an answer.

**Decided 2026-09-13.** All eight cards answered. Type scale five steps with 13
merging into 12; all 12 spacing steps kept; two radius tokens; tints preserved
(13 tokens, `bad/60` included); `on-accent` added; code names kept; no button
size axis; dark mode out of v1. The resulting spec is in
`docs/figma-design-system-step3.md`.

### 3. Tokens into code
Full spec, with every call site and value: `docs/figma-design-system-step3.md`.
Fifteen `@theme` additions (11px type step, container, 13 tints, `on-accent`),
19 call-site replacements, `tokens/tokens.json` emitted for step 4, plus the
arbitrary-value lint rule. Branch + PR, reviewed by a designer and an engineer.

Runs in Claude Code inside this repo, not from Cowork.

The PR carries a visual regression check: screenshot every route on `main` and
on the branch, publish the diffs as a CI artefact. Designers review the diff
images, not the TSX. For cards 1 and 4 the expected diff is known in advance
(see the board); anything else is a bug. The workflow file and route list are
part of the handoff so the portco owns the check after we leave.

### 4. Generate the Figma library (done 2026-09-13)
Via Figma MCP, skills `figma-generate-library` + `figma-use`. One file, pages
inside it, not two files: Cover, Foundations, then one page per component.

44 variables across Colour, Type, Spacing and Radius, all scoped with WEB code
syntax. 11 text styles, named size/weight, with uppercase and tracking baked into
the label styles. 21 components covering every export in
`src/components/ui/index.tsx`.

Structure mirrors the code rather than improving on it: no primitive/semantic
split, because the codebase has none and there would be nothing to sync it
against.

Pace to the MCP rate limit (200 calls/day on Professional).

### 4b. Publish, then create the product file
Publishing turns the file into a team library so other files can use its
components and variables, and makes updates versioned: subscribers are notified
and choose when to accept. Until it is published the components exist only in
that one file.

Then create a separate **product file** that subscribes to the library. Screens
are designed there, never in the library file, so that half-finished work is
never one click from being published to the whole team. Give it three pages:

- **Screens**: real work, built from library components.
- **Proposals**: anything the library does not have yet (see step 7).
- **Archive**: explorations worth keeping but no longer current.

For a first-time setup, create this file at the same time as the library, before
any designer opens Figma. If it does not exist on day one, screens get designed
in the library file and the separation never happens afterwards.

Two steps here are UI-only and cannot be done through the API: publishing, and
toggling the library on in the product file (Assets panel, library icon).

### 5. Code Connect, or the map (done 2026-09-13)
Code Connect needs an Organization plan and this workspace is on Professional,
so the equivalent is hand-maintained: `tokens/figma-map.json` records, per
component, the source file, the import line and which Figma property maps to
which prop. The entries that matter most are the null mappings, the properties
that map to no prop at all.

`docs/agents/design-system.md` tells an agent when to read it, and covers the
design-led change loop.

### 6. Guardrail (done 2026-09-13)
ESLint rule (or Tailwind config) banning arbitrary values (`text-[..]`, `#hex`) in
`src/components/` and `src/app/`. Prevents drift from day one.

### 7. The loop for gaps
When a design needs something the library does not have, it is drafted on the
product file's Proposals page, built in code first, and only then added to the
library. The proposal is deleted once the real component exists. Full loop in
`docs/agents/design-system.md`.

## Using it (after step 5)

1. Designer builds the feature in Figma from `Beefcake / Components`.
2. Claude Code gets the Figma URL, reads it via MCP + Code Connect.
3. Claude Code composes existing primitives. New primitive needed: add it to `index.tsx` first, push to Figma, then use it.
4. Review checks for one thing: any new hardcoded value. The lint rule catches most.

Reverse direction (code first, e.g. admin surface): build with tokens, push the
screen to Figma with `figma-generate-design` so the file stays current.

## Prerequisites

- Figma Full seat (Professional plan or higher) for whoever runs step 4. View
  seats cannot create variables or components, via MCP or otherwise.
- Figma MCP configured in Claude Code for step 4 and 5, or run those from Cowork.

## Out of scope for the first pass

- Refactoring existing screens beyond the 5 arbitrary values.
- Dark mode, unless designers opt in at step 2.
- Marketing or member-facing visual language. This is the operator tool.

## Owners

| Step | Owner | Tool |
|---|---|---|
| 1 | Claude | Cowork, read-only |
| 2 | Claude proposes, designers decide | FigJam |
| 3 | Claude Code + engineer review | repo, PR |
| 4, 5 | Claude, designer reviews the result | Figma MCP |
| 6 | Engineer | repo |
