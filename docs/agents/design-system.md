# Design system

How to implement a screen when someone hands you a Figma URL.

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
