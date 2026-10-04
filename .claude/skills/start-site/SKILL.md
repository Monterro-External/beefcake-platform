---
name: start-site
description: Use when asked to start, run or open the site locally. Starts it through the Aspire AppHost and lists every link (Aspire dashboard, web, tenant, member and admin surfaces).
---

# Start site

1. Run `node .agents/skills/start-site/scripts/start-site.mjs` from the repo root. It installs dependencies and seeds a small database only when they are missing, reuses an AppHost that is already running, and waits until `web` is healthy.
2. Done when the script prints `Site is up`. Relay its link list to the user verbatim, one link per line; the dashboard link carries a login token, so pass it whole.

If the script fails, read `aspire-orchestration` for port conflicts and orphaned processes, and `aspire-monitoring` for the `web` logs.
