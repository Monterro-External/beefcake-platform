# design-sync notes (Beefcake UI)

Project: Beefcake UI, https://claude.ai/design/p/91c83873-8e0e-4912-b3af-f3954d09ba14

## How this repo is built for sync

- There is no `dist/`: the kit lives in the Next app at `src/components/ui/index.tsx`. Run
  `node .design-sync/build-dist.mjs` (`cfg.buildCmd`) before the converter. It writes
  `.design-sync/.cache/pkg/` (gitignored): an ESM `index.js`, `.d.ts` via
  `.design-sync/tsconfig.dist.json`, and `styles.css` compiled from `.design-sync/tailwind-entry.css`.
- Converter run: `node .ds-sync/package-build.mjs --config .design-sync/config.json --node-modules ./node_modules --out ./ds-bundle`
  (`cfg.entry` points at the built pkg, so no `--entry` flag).
- `next/link` is aliased to `.design-sync/shims/next-link.tsx`, a plain `<a>`. LinkButton, Tabs
  and Pagination use it.
- Tailwind only emits classes it finds. It scans `src/` automatically; `.design-sync/previews`
  is a dot-dir, so it is added with an explicit `@source`. A class used only in a new preview
  needs the dist rebuilt, or it renders unstyled (this hit Meter's `w-48`).
- `@source inline(...)` lines in `tailwind-entry.css` safelist the layout vocabulary that
  `conventions.md` promises the design agent. Changing either means checking the other.
- TR, TH and TD are all-caps, which the converter reads as constants. `componentSrcMap` pins
  them back so they are exported on `window.BeefcakeUI`; they get no card of their own and are
  shown through the Table and THead previews.
- Groups mirror the section comments in `src/components/ui/index.tsx` via `docsMap` stubs in
  `.design-sync/groups/`. A new component needs a `docsMap` entry or it lands in `general`.
- TypeScript and ESLint skip `.design-sync/` (dot-dir), so previews importing `beefcake-ui` do
  not affect `npm run typecheck`.

## Scope decisions

- `src/components/layout/` is not synced: Shell, PersonaSwitcher, StopImpersonating and
  NotAllowed need sessions, server actions or `next/navigation`; MainNav needs `usePathname`.
- Input has no disabled styling in source. Its preview deliberately has no Disabled cell, and
  the conventions tell the agent not to design one. If the kit gains a disabled style, add it.

## Known render warns

- None at last sync.

## Re-sync risks

- `next/link` shim: if the kit starts using Link props beyond href/className/children (e.g.
  `prefetch` semantics), the shim silently drops them.
- The safelist in `tailwind-entry.css` is hand-maintained against the `@theme` tokens in
  `src/app/globals.css`. A new token there is not offered to the agent until it is added to both
  the safelist and `conventions.md`.
- `build-dist.mjs` assumes `@tailwindcss/postcss`, `postcss`, `esbuild` and `tsc` from the repo's
  own `node_modules`. A Tailwind major bump may change the `@source inline` syntax.
- Render checks used Playwright 1.62.1 with the cached chromium-1234.
