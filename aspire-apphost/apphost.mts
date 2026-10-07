// Aspire TypeScript AppHost
// For more information, see: https://aspire.dev

import { createBuilder, type ContainerResourcePromise } from './.aspire/modules/aspire.mjs';

const PROJECT = 'beefcake-platform';

/**
 * Labels a container as part of this project, so Docker Desktop and
 * `docker compose ls` show every container from this AppHost in one group.
 * Wrap each `addContainer()` (or container integration) in it.
 */
export const grouped = (container: ContainerResourcePromise): ContainerResourcePromise =>
    container.withContainerRuntimeArgs(['--label', `com.docker.compose.project=${PROJECT}`]);

const builder = await createBuilder();

// `npm run dev` at the repo root. The SQLite file stays at data/beefcake.db
// ($BEEFCAKE_DB), so run `npm run db:reset -- --scale small` first.
// No install on start: `npm install` rewrites package-lock.json; run `npm ci` yourself.
// Port 3000 is Playwright's baseURL, so local e2e runs reuse this server and
// land in its logs; CI has no AppHost and starts its own `npm run dev`.
await builder
    .addNextJsApp('web', '..')
    .withNpm({ install: false })
    .withEndpointCallback('http', async (endpoint) => {
        await endpoint.port.set(3000);
        await endpoint.isProxied.set(false);
    })
    .withBrowserLogs();

await builder.build().run();
