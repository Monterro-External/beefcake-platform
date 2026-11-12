# Beefcake UI: how to build with it

Beefcake is gym management software used at a front desk eight hours a day. Plain, dense, high
contrast, no animation, nothing that moves while someone is reading it. Two greys and one blue
accent. Do not add shadows, gradients, illustrations or transitions.

## Setup

No provider or wrapper is needed. Components are on `window.BeefcakeUI` and are styled by
`styles.css` (Tailwind v4 output plus the `@theme` tokens). Put screens on the page background
(`bg-surface`, body text 14px `text-ink`) and content blocks in `Card`.

## Styling idiom: Tailwind utilities on the Beefcake tokens

Use utility classes for your own layout glue. Only classes compiled into `styles.css` exist; do
not write arbitrary values (`w-[37px]`) or colours outside this list.

| Family | Classes |
|---|---|
| Text colour | `text-ink`, `text-ink-muted`, `text-accent`, `text-good`, `text-warn`, `text-bad`, `text-on-accent` |
| Surfaces | `bg-surface` (page), `bg-surface-raised` (cards, inputs), `bg-accent-soft`, `bg-good-soft`, `bg-warn-soft`, `bg-bad-soft`, `bg-good-subtle`, `bg-warn-subtle`, `bg-bad-subtle` |
| Borders | `border border-line`, `border-line-soft`, `border-accent`, `border-good-line`, `border-warn-line`, `border-bad-line`, `rounded` |
| Type | `text-2xs` (11px), `text-xs`, `text-sm`, `text-xl` (page titles), `text-2xl` (stat values), `font-medium`, `font-semibold`, `font-mono`, `tabular-nums`, `uppercase tracking-wide` (section labels) |
| Layout | `flex`, `grid`, `grid-cols-2`..`grid-cols-4`, `gap-2`, `gap-3`, `gap-4`, `gap-6`, `space-y-3`, `px-4 py-3`, `mx-auto max-w-shell` (page width) |

Tones are one vocabulary across components: `tone="neutral" | "good" | "warn" | "bad" | "info"`
on `Badge`, `StatTile`, `Meter` and `Callout`. Good is green, warn amber, bad red, info is the
blue accent.

## Composition rules

- Tables: `Table` > `THead` > `TR` > `TH`, then a plain `<tbody>` of `TR` > `TD`. Always put a
  `Table` inside a `Card`: it uses negative margins to run edge to edge in the card body.
- Money and other figures: `TD align="right" mono`. A SEK amount reads `449,00 kr`. The currency
  comes from the amount, never from the reader's locale.
- `Field` wraps one `Input` or `Select` with an uppercase label and optional hint.
- `Button` is for actions (`variant` primary | secondary | danger | ghost; one primary per area).
  `LinkButton`, `Tabs` and `Pagination` navigate by `href` and render plain links.
- `Input` has no disabled styling; do not design a disabled input state.
- Empty lists get `EmptyState` inside the same `Card`, never a blank card.

## Where the truth lives

Read `styles.css` (the `@theme` block lists every colour token) and each component's
`.prompt.md` before styling. Per-component examples there are verified renders.

## Example

```jsx
const { PageHeader, Button, StatTile, Card, Table, THead, TR, TH, TD, Badge } = window.BeefcakeUI;

<div className="mx-auto max-w-shell px-6 py-6">
  <PageHeader title="Payments" subtitle="Södermalm · amounts in SEK"
    actions={<Button variant="primary">Run retries</Button>} />
  <div className="mb-6 grid grid-cols-3 gap-3">
    <StatTile label="Collected, November" value="583 000 kr" />
    <StatTile label="Failed on last run" value="6,3 %" tone="warn" hint="79 of 1 250 charges" />
    <StatTile label="Abandoned" value="4" tone="bad" />
  </div>
  <Card title="Open charges (2)">
    <Table>
      <THead><TR><TH align="right">Amount</TH><TH>Why it failed</TH><TH>Status</TH></TR></THead>
      <tbody>
        <TR><TD align="right" mono>449,00 kr</TD><TD>Insufficient funds</TD><TD><Badge tone="warn">Retrying</Badge></TD></TR>
        <TR><TD align="right" mono>449,00 kr</TD><TD>Mandate revoked</TD><TD><Badge tone="bad">Abandoned</Badge></TD></TR>
      </tbody>
    </Table>
  </Card>
</div>
```
