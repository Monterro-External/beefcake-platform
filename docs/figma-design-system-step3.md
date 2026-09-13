# Step 3 handoff: tokens into the codebase

Decisions from the FigJam board, 2026-09-13:
https://www.figma.com/board/Q5gE0k6BiuC2m1lNRUXtwc

Run this in Claude Code inside this repo, on a branch, as one PR. No Figma work
here. Step 4 (the Figma library) reads `tokens/tokens.json` produced by this step.

## Approved decisions

| Card | Decision |
|---|---|
| 1 Type scale | Five steps: 11, 12, 14, 20, 24. 10 merges into 11. 13 merges into **12**. |
| 2 Spacing | Keep the 4px unit. Name **all 12** steps in use. Add a container token, 92rem. |
| 3 Radius | Two tokens: 4px and full. |
| 4 Tints | Take the two invisible merges. **Preserve** every other value (13 tokens). `bad/60` becomes a tint token. |
| 5 On accent | Add `on-accent`, white. |
| 6 Names | Keep the code vocabulary. Group as color/ink, color/surface, color/accent, color/status. |
| 7 Button | No size axis in v1. |
| 8 Dark mode | Out of scope for v1. |

## 1. Type scale

The approved sizes are 11, 12, 14, 20, 24. Four of the five already exist under
Tailwind's own names (`xs` 12, `sm` 14, `xl` 20, `2xl` 24), so only 11px is new.

Use Tailwind's names, not the `2xs/xs/sm/lg/xl` labels written on the board card.
The board's labels would have renamed `text-xl` to `text-lg` and `text-2xl` to
`text-xl`, which changes call sites for no benefit and invites a silent mistake
where a stale class still resolves to a default.

```css
@theme {
  --text-2xs: 0.6875rem; /* 11px */
}
```

Call site changes:

| Where | From | To |
|---|---|---|
| `(tenant)/app/classes/day-picker.tsx:49` | `text-[11px]` | `text-2xs` |
| `(tenant)/app/classes/day-picker.tsx:51` | `text-[10px]` | `text-2xs` |
| `components/ui/index.tsx:271` | `text-[11px]` | `text-2xs` |
| `components/ui/index.tsx:285` | `text-[11px]` | `text-2xs` |
| `components/ui/index.tsx:145` | `text-[13px]` | `text-xs` |

Expected visual diff: the 10px "today" label grows 1px; mono table numerals
shrink 1px. Nothing else.

## 2. Spacing and container

Tailwind's 4px unit already produces every value in use, so the scale needs no
`@theme` entries. Only the container is new:

```css
@theme {
  --container-shell: 92rem;
}
```

`components/layout/shell.tsx:37` and `:64`: `max-w-[92rem]` becomes `max-w-shell`.

Expected visual diff: none.

## 3. Radius

`rounded` (4px) and `rounded-full` are Tailwind defaults and every use already
maps to one of them. No code change. The two tokens exist for the Figma library.

## 4. Tints

Thirteen opaque tokens replacing fifteen alpha modifiers. Values are the current
alpha composited over `--color-surface`.

```css
@theme {
  /* badge backgrounds */
  --color-line-soft: oklch(0.945 0.003 250);   /* was line/50, line/60 */
  --color-good-soft: oklch(0.937 0.016 162.5); /* was good/12 */
  --color-warn-soft: oklch(0.941 0.025 84.4);  /* was warn/15 */
  --color-bad-soft: oklch(0.932 0.018 12.3);   /* was bad/12 */
  /* callout backgrounds */
  --color-good-subtle: oklch(0.964 0.008 170.1); /* was good/6 */
  --color-warn-subtle: oklch(0.964 0.012 85.4);  /* was warn/8 */
  --color-bad-subtle: oklch(0.961 0.008 6.1);    /* was bad/6, bad/8 */
  /* borders */
  --color-good-line: oklch(0.857 0.039 157.5);  /* was good/30 */
  --color-warn-line: oklch(0.861 0.068 83.4);   /* was warn/40 */
  --color-bad-line: oklch(0.846 0.048 16.3);    /* was bad/30 */
  --color-accent-line: oklch(0.846 0.044 243.1);/* was accent/30 */
  --color-bad-line-strong: oklch(0.799 0.066 17.3); /* was bad/40 */
  /* data */
  --color-bad-bar: oklch(0.707 0.105 19.2);     /* was bad/60 */
}
```

Replacements in `components/ui/index.tsx`:

| Line | From | To |
|---|---|---|
| 97 | `border-line/60` | `border-line-soft` |
| 161 | `bg-line/50` | `bg-line-soft` |
| 162 | `bg-good/12` | `bg-good-soft` |
| 163 | `bg-warn/15` | `bg-warn-soft` |
| 164 | `bg-bad/12` | `bg-bad-soft` |
| 275 | `bg-bad/60` | `bg-bad-bar` |
| 299 | `border-bad/40` | `border-bad-line-strong` |
| 299 | `hover:bg-bad/8` | `hover:bg-bad-subtle` |
| 495 | `border-good/30 bg-good/6` | `border-good-line bg-good-subtle` |
| 496 | `border-warn/40 bg-warn/8` | `border-warn-line bg-warn-subtle` |
| 497 | `border-bad/30 bg-bad/6` | `border-bad-line bg-bad-subtle` |
| 498 | `border-accent/30` | `border-accent-line` |

Two things the PR reviewer should know.

**Preserve keeps an inconsistency.** `good-line` and `bad-line` are 30% while
`warn-line` is 40%. That asymmetry is in the product today and Preserve keeps
it by definition. Folding warn to 30% is a one-line change whenever a designer
wants it.

**Opaque tokens do not adapt to what is behind them.** An alpha tint over a
Card (`surface-raised`, white) renders slightly differently than over the page
(`surface`). The tokens above use the `surface` composite. Where a Badge sits on
a Card the difference is at most sRGB distance 5.4, below the ~6 threshold where
a side-by-side comparison starts to show it, but it is not literally zero. Expect
a handful of near-threshold pixels in the regression diff on Card-heavy pages.

## 5. On accent

```css
@theme {
  --color-on-accent: oklch(1 0 0);
}
```

`components/ui/index.tsx:297`: `bg-accent text-white` becomes `bg-accent text-on-accent`.

## 6. tokens.json

Emit `tokens/tokens.json` in W3C DTCG format covering color (the 10 existing plus
the 14 added here), the type scale, spacing, radius and the container. This file
is the input to step 4, so every token needs a stable name matching the CSS
custom property minus the `--color-` / `--text-` prefix.

## 7. Guardrail

Add an ESLint rule (or a Tailwind lint step) failing on arbitrary values in
`src/components/` and `src/app/`: `text-[`, `bg-[`, `p-[`, `#` hex literals, and
alpha modifiers on color tokens (`/NN`). After this PR there are zero of each, so
the rule starts clean.

## 8. Verification

- `npm run lint`, `npm run typecheck`, `npm test` pass.
- Visual regression: screenshot every route on `main` and on the branch, publish
  diffs as a CI artefact. Expected diffs, and nothing else:
  - `/app/classes`: day-picker "today" label 1px larger.
  - Any page with mono table numerals: 1px smaller.
  - Card-heavy pages: sub-threshold tint shifts on Badges (see the note above).
- A designer reviews the diff images, not the TSX.
