// Builds src/components/ui into a package the design-sync converter can read.
// The repo has no dist/ of its own: the kit lives inside the Next app. This
// produces .design-sync/.cache/pkg with an ESM entry, .d.ts and the compiled
// Tailwind stylesheet. Run from the repo root: node .design-sync/build-dist.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

const root = process.cwd();
const out = resolve(root, '.design-sync/.cache/pkg');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 1. The components, as ESM. React stays external; next/link becomes an <a>.
await build({
  entryPoints: [resolve(root, 'src/components/ui/index.tsx')],
  outfile: resolve(out, 'index.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  alias: {
    'next/link': resolve(root, '.design-sync/shims/next-link.tsx'),
    '@': resolve(root, 'src'),
  },
  logLevel: 'warning',
});

// 2. Type declarations, JSDoc included.
execFileSync(resolve(root, 'node_modules/.bin/tsc'), ['-p', '.design-sync/tsconfig.dist.json'], {
  stdio: 'inherit',
});

// 3. The stylesheet: the @theme tokens plus every utility in use.
const entryCss = resolve(root, '.design-sync/tailwind-entry.css');
const result = await postcss([tailwind({ base: root })]).process(readFileSync(entryCss, 'utf8'), {
  from: entryCss,
});
writeFileSync(resolve(out, 'styles.css'), result.css);

writeFileSync(
  resolve(out, 'package.json'),
  JSON.stringify(
    {
      name: 'beefcake-ui',
      version: JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version,
      type: 'module',
      module: 'index.js',
      types: 'types/components/ui/index.d.ts',
      style: 'styles.css',
    },
    null,
    2,
  ) + '\n',
);
console.log(`built ${out}`);
