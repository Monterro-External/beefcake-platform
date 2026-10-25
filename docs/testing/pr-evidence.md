# Acceptance specs and PR evidence

Acceptance tests follow the [Playwright Test Agents](https://playwright.dev/docs/test-agents)
layout: plans in `specs/`, a seed test, and generated tests that link back to
their plan. The requirements themselves live in Linear.

## Where things live

- **The Spec issue** (Linear, BCPLA, parent of the implementation tickets; see
  `docs/agents/issue-tracker.md`) holds the story, the acceptance criteria and the
  Gherkin scenarios in one ```` ```gherkin ```` block, each scenario named with a
  stable id (`AS-1 …`). It is the only source of the requirements; prepare it with
  `/spec-to-scenarios <spec-id>`.
- **Implementation tickets** (sub-issues) say which scenarios they make pass, on a
  line of their own: `Covers: AS-1, AS-3`.
- **`specs/<feature>.md`** holds the Playwright test plan the planner writes, with
  a `**Spec:**` line. It is written when the feature is built, never by hand
  during discovery, and it holds no Gherkin of its own: CI reads scenarios only
  from the Spec issue. The planner brief `/spec-to-scenarios` saves as
  `specs/<spec-id>-brief.md` carries a word-for-word copy for the planner, and
  nothing else reads it. The Acceptance blocks in the older specs are leftovers
  that move to their Spec issue once it exists; don't copy them into a new file.
- **Tests** carry the Spec tag (`@BCPLA-<n>`) and a title equal to the scenario
  name, id included.
- **Tags** are listed in `docs/test-tags.md`.

```
specs/<feature>.md                          Playwright test plan and Spec line
tests/e2e/seed.spec.ts                      starting point for the planner and generator
tests/e2e/<feature>/<scenario-name>.spec.ts one generated test per scenario
tests/e2e/evidence.ts                       recordEvidence: video and trace, unless BDD_RECORDING=off
```

## The PR comment

A PR runs the job when it is opened or reopened and on every push. It runs the
`@acceptance` tests of the Specs the PR links (step 2 below) in Chromium,
recording video and trace, and creates or updates one bot comment. A PR that
links no Spec records nothing. Every Spec's `@acceptance` tests also run,
unrecorded, in the end-to-end job (`BDD_RECORDING=off`), so a PR still cannot
break another Spec unnoticed. Editing the title or description does not start a
run; re-run the job instead, and it reads the PR as it is then.

1. **Find the tickets.** CI reads every `BCPLA-<n>` in the branch name, the PR
   title and the PR description. Linear's own branch names (`per/bcpla-143-…`) work.
   Every mention counts, an example or a "see also" included: a ticket named in
   passing links its Spec, and its `Covers:` line claims scenarios for this PR.
   Write `a Spec` or a link text without the id when you don't mean the ticket.
2. **Find the Spec.** For each ticket it reads the issue and its parent from Linear.
   The Gherkin comes from the parent; a ticket that carries the Gherkin itself is
   its own Spec.
3. **Pick the scenarios.** The ticket's `Covers:` line names them, and those are
   **claimed**: each needs a passing, recorded test. `Covers: none` claims nothing.
   A ticket without the line, or the Spec linked directly, shows every scenario
   but claims none, so a Spec can be linked before anything is built.
4. **Match the tests.** A scenario's test is the one tagged with the Spec and titled
   with the scenario name.

The comment lists each ticket and what it covers, then each shown scenario with
its Given/When/Then steps, its result, approximate video timestamps for every
named test step, links to the tested source lines, and a link to the private CI
artifact with the report and recordings. A scenario without a test reads *Not
built yet*. The Spec's other scenarios are listed by id only.

The check fails when a claimed scenario has no test, or any shown scenario's test
failed or was skipped, or its video, trace or timeline is missing, or a ticket
covers an id the Spec does not have, or the Spec's Gherkin is invalid. A shown but
unclaimed scenario without a test is listed as not built yet, and scenarios tagged
`@wip` as planned; neither fails it. A video exists only where a test ran.

The check does not fail, and the comment says why, when no ticket is linked, the
Spec has no Gherkin yet, or Linear cannot be read.

### Linear access

The job reads Linear with the repository secret `LINEAR_API_KEY`: a Linear API key
with read access to Beefcake-platform. Without it the comment says the tickets
could not be read. Fork and Dependabot PRs never receive secrets.

## Adding a feature

The chain from Product Ticket to tickets is in `AGENTS.md` (Product ticket to
implementation tickets).

1. Run `/spec-to-scenarios <spec-id>`. It adds the Gherkin to the Spec, with
   exactly one type tag per scenario (`@happy`, `@edge`, `@error`, `@negative`,
   `@regression`; at least one `@happy`, `@error` and `@regression`), and saves
   the planner brief. `npm run spec:check -- <brief | spec-id>` runs CI's parser
   on it.
2. Run `/to-tickets <spec-id>`. Each ticket gets its `Covers:` line, or
   `Covers: none` when it makes no scenario pass.
3. Build the ticket. Once its screens run locally, ask the
   `playwright-test-planner` agent for the plan in `specs/<feature>.md`, and
   review it. The planner explores the running app, so it cannot plan a screen
   that does not exist yet.
4. Ask the `playwright-test-generator` agent to write the tests. Each file starts
   with `// spec: specs/<feature>.md`, its title equals the scenario name, its
   describe is tagged `@acceptance` and the area, the test is tagged with its type
   and the Spec, it calls `test.use(recordEvidence)`, and each step is a named
   `test.step`. Use one browser page per scenario so each timeline matches one
   recording.
5. Ask the `playwright-test-healer` agent to fix failing tests. A test it marks as
   skipped needs a person to decide whether it is a product bug.
6. Name the ticket in the branch or PR, so the comment shows its scenarios, and
   no other ticket you don't mean to claim.

## Running locally

```bash
npm run db:reset -- --scale small
npm run test:e2e -- --grep @acceptance --project=chromium
npm run test:e2e -- --grep @BCPLA-<n> --reporter=html && npx playwright show-report
```

Recordings are saved under `test-results/`.

## Comment permissions

The acceptance job uses `contents: read` and `pull-requests: write`. Only
same-repository PRs receive a bot comment. Fork and Dependabot PRs keep the
workflow summary and artifacts without attempting a write. A completed run for
an older PR head does not overwrite the current comment. No
`pull_request_target` workflow is used.
