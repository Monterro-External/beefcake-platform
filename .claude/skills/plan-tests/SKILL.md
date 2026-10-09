---
name: plan-tests
description: "Plan, generate and run Playwright tests for a feature or Spec, managing the planner and generator subagents."
disable-model-invocation: true
---

# Plan tests

You are the **manager**: the planner and generator subagents do the browser work; you brief them, watch them, unstick them and own the green run. The user hears from you at every launch, stall and hand-back.

## Steps

1. **Server.** Start the site with `npm run aspire:start` (or `npm run dev`, whose output lands in `data/dev.log`). Done when `/app` returns 200 and you know where its log is.

2. **Plan.** Launch `playwright-test-planner` in the background with a **time-boxed** brief:
   - the target (Spec id or feature) and `specs/<feature>.md` as the file;
   - at most ~25 browser actions, then save what it has, marking unchecked steps `(not verified)`;
   - open questions in the overview text.

   Then arm the watcher (step 4). Done when the plan file exists and has no suite of questions.

3. **Generate.** Launch `playwright-test-generator` in the background on the plan, writing to `tests/e2e/<feature>/`, about 6 browser actions per scenario, each test run with `test_run` once written. Arm the watcher. Done when it hands back.

4. **Watch** (after every launch). Start the Monitor tool, `timeout_ms` 1800000, on
   `.claude/skills/plan-tests/scripts/watch-agent.sh <output_file> [tests/e2e/<feature>]`, with `output_file` from the Agent result. One line a minute; relay progress in a short line when the user asks or a file appears.
   - On `STALL`: TaskStop the agent, then SendMessage the same agent id with narrower orders (save now, skip the call that hung). It keeps what it explored; a fresh agent starts over.
   - On `DONE`: stop the monitor.

5. **Verify.** Close the MCP browser with `browser_close`. Run `npx tsc --noEmit -p tests/e2e/tsconfig.json`, `npx eslint tests/e2e/<feature>`, then `npx playwright test tests/e2e/<feature> --project=chromium --reporter=list`. When several fail the same way, run an existing spec (`tests/e2e/personas.spec.ts`) as a control: if it fails too, the server is at fault, not the tests. Fix the tests, or tag `@wip` what is not built. Done when every test passes or is `@wip`.

6. **Read the logs** as in AGENTS.md "Read the logs after a test run": every 5xx or error that no test asserted on is reported.

7. **Report**: files, one line per scenario, what you fixed, open questions.
