#!/usr/bin/env node
// Starts the site through the Aspire AppHost and prints every link to it.
// Idempotent: reuses a running AppHost, installs and seeds only when missing.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../../..');
// Aspire spawns `npm run dev`; keep it on the node running this script.
const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}` };

const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, env, stdio: 'inherit' });
const read = (cmd, args) => execFileSync(cmd, args, { cwd: root, env, encoding: 'utf8' });
const json = (args) => {
  const out = read('aspire', [...args, '--format', 'Json', '--nologo']);
  return JSON.parse(out.slice(out.search(/[[{]/)));
};

if (!existsSync(resolve(root, 'node_modules'))) run('npm', ['ci']);

const db = resolve(root, process.env.BEEFCAKE_DB ?? 'data/beefcake.db');
if (!existsSync(db)) run('npm', ['run', 'db:reset', '--', '--scale', 'small']);

const appHost = resolve(root, 'aspire-apphost/apphost.mts');
const running = () => json(['ps']).find((a) => a.appHostPath === appHost && a.status === 'running');

if (!running()) run('aspire', ['start', '--non-interactive', '--nologo']);
run('aspire', ['wait', 'web', '--timeout', '180', '--nologo']);

const links = [['Aspire dashboard', running()?.dashboardUrl]];
for (const r of json(['describe']).resources) {
  for (const u of r.urls ?? []) links.push([`${r.displayName} (${u.name})`, u.url]);
  if (r.displayName === 'web') {
    const base = r.urls?.find((u) => u.name === 'http')?.url;
    if (base) {
      links.push(['Tenant surface', `${base}/app`]);
      links.push(['Member surface', `${base}/me`]);
      links.push(['Admin surface', `${base}/admin`]);
    }
  }
}

const width = Math.max(...links.map(([label]) => label.length));
console.log('\nSite is up:\n');
for (const [label, url] of links) if (url) console.log(`  ${label.padEnd(width)}  ${url}`);
console.log('\nStop with `aspire stop`.');
