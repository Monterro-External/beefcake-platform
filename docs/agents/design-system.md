# Design system

How to implement a screen when someone hands you a Figma URL.

## The three Figma files

| File | Holds | Published? |
|---|---|---|
| Beefcake token decisions (FigJam) | why each token has the value it has | n/a |
| Beefcake design system | Foundations and the 21 components | yes, as a team library |
| Beefcake product | screens, and proposals for gaps | never |

Screens are designed in the product file, which subscribes to the library. The
library file is not a place to design: anything sitting in it is one click from
being published to everyone.

## The short version

`tokens/figma-map.json` translates Figma components and variables into this
codebase's components, props and Tailwind classes. Read it before writing any
markup from a design.

## Why a hand-maintained map

Figma Code Connect does this automatically, but it needs an Organization plan
and this workspace is on Professional. The map is the same information kept by
hand. It only has to cover the gap between what a Figma node already tells you
(component name, variant values, token names) and what the code calls those
things, which is small because the Figma library was generated from this repo
and deliberately kept the code's vocabulary.

## Reading a design

1. Read the frame via the Figma MCP. Instances carry the component-set name and
   their variant values, e.g. `Button` with `Variant=primary, State=default`.
2. Look the component up in `tokens/figma-map.json`. Use the `codeProp` mapping.
   A property with `"codeProp": null` is presentational: `State=hover` is CSS,
   `State=disabled` is the native attribute. Never invent a prop for it.
3. For anything under `notYetInFigma`, the design will show a plain frame rather
   than an instance. Match it to the component in `src/components/ui/index.tsx`
   by what it does, and say in your PR description which one you picked.
4. Colours, type, spacing and radius in the design are bound to variables whose
   leaf name is the Tailwind class. Use the class, never the hex. If a design
   shows a value with no variable behind it, that is a bug in the design, not a
   licence to hardcode: flag it.

## Keeping it honest

The codebase is the source of truth. `tokens/tokens.json` is generated from
`src/app/globals.css`, and the Figma variables were generated from that. If
Figma and code disagree, the code is right and the Figma file is stale.

The lint rule in `eslint.config.mjs` blocks arbitrary Tailwind values, raw hex
and alpha modifiers on colour tokens, which is what stops the two drifting apart
quietly. If you need a value that does not exist yet, add a token in
`globals.css`, regenerate `tokens/tokens.json`, and note that Figma needs the
same variable added.

When you add or change a component in `src/components/ui/index.tsx`, update
`tokens/figma-map.json` in the same PR if it is mapped there.

## When the design needs something that does not exist

The rule above ("the codebase is the source of truth") governs what ships, not
where thinking happens. Exploring in Figma is free. What goes through code is
publication: the moment something becomes a thing other people build with.

Four kinds of gap. Two of them need no ceremony at all.

**A new arrangement of existing components.** A new screen, a new layout. Design
it from the library, hand over the URL, compose existing components. Nothing
flows back to Figma. This is most design work and it should stay frictionless.

**A new variant of an existing component**, for example a small button for table
row actions. The published component set was generated from this repo, so a
variant added in Figma has no code behind it and no entry in
`tokens/figma-map.json`. The mock is a specification, not an artifact.

**A genuinely new component.** Same as above, larger.

**A new token.** The strictest case, because tokens are shared vocabulary and a
new one affects every surface. It goes back through a numbered decision card on
the token board, in the same format as the original eight.

### The loop, for the cases that need it

1. The designer drafts on the product file's Proposals page, explicitly not in
   the library file, and names what is new: variant, component, or token.
2. A new token gets a decision card before anything is built.
3. Implement in this repo. The lint rule is what stops an arbitrary value
   sneaking in while the shape is still being worked out. Normal PR.
4. Once merged, regenerate or extend the Figma component from the merged code,
   then publish the library.
5. Update `tokens/figma-map.json` in the same PR.
6. Delete the proposal and replace it with an instance of the real component.

Step 6 is the one that gets skipped and the one that matters. A proposal left on
the canvas is a second source of truth that looks exactly like the first, and
people will build from it.

### Why this direction

The system already lives in code, the team is small, and nobody owns a design
system full time. If Figma were authoritative, every token change would be
hand-copied into code, which is the drift this setup exists to remove.

At an organisation with a dedicated design system team and engineers as
consumers, the arrow points the other way and that is correct. The question is
who maintains the system, not which tool is better.

### Known friction on the current plan

Figma branching, the natural home for proposals, is available on Organization
and Enterprise only. This workspace is on Professional, so proposals live on a
page in a separate product file by convention rather than by enforcement. Code
Connect is gated the same way, which is why `tokens/figma-map.json` exists.
