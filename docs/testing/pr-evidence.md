# Acceptance specs and PR evidence

> **Paused.** The PR evidence job (`acceptance` in `.github/workflows/ci.yml`) is
> disabled while it is changed to read the Gherkin from the tickets linked to the
> PR. The `@acceptance` tests still run in the `e2e` job; there is no PR comment.

Acceptance tests follow the [Playwright Test Agents](https://playwright.dev/docs/test-agents)
layout: plans in `specs/`, a seed test, and generated tests that link back to
their plan. CI reads the same files to describe each pull request.

Every opened, updated or reopened PR runs the `@acceptance` scenarios in Chromium.
One bot comment is created or updated with:

- The change summary copied from specs added or updated in the PR.
- Each acceptance scenario, its Given/When/Then steps and its actual result,
  including failures and retries.
- A link to the private CI artifact containing reports, recordings and specs.
- Approximate video timestamps, named test steps and links to the tested source lines.

The PR's human-written body is preserved. If no spec changed, the comment says
so and labels the tested scenarios as existing regression coverage.

## Where things live

- **The Spec issue** (Linear, BCPLA, parent of the implementation tickets; see
  `docs/agents/issue-tracker.md`) holds the story, the acceptance criteria and the
  Gherkin scenarios, each named with a stable id (`AS-1 …`). It is the only source
  of the requirements; prepare it with `/ticket-to-scenarios <spec-id>`.
- **Implementation tickets** (sub-issues) say which scenarios they make pass:
  `Covers: AS-1, AS-3`.
- **`specs/<feature>.md`** holds the Playwright test plan the planner writes, with
  a `**Spec:**` line. The older specs still carry an Acceptance block until
  their Spec issue exists in Linear.
- **Tests** carry the Spec tag (`@BCPLA-<n>`) and a title equal to the scenario
  name, id included, so scenarios and tests match by id, not by copied text.
  When the PR evidence job returns, it follows PR → ticket → Spec → covered scenarios.
- **Tags** are listed in `docs/test-tags.md`.

## Layout

```
specs/<feature>.md                         Playwright test plan and Ticket line
tests/e2e/seed.spec.ts                     starting point for the planner and generator
tests/e2e/<feature>/<scenario-name>.spec.ts one generated test per scenario
tests/e2e/evidence.ts                      recordEvidence: video and trace on every run
```

## Adding a feature

1. Write `specs/<feature>.md` in English with a `# Title`, a `## Change summary`
   describing what this PR actually changes, and `## Acceptance` holding one
   ```` ```gherkin ```` block. Write scenarios declaratively.
2. Tag scenarios as in `docs/test-tags.md`: exactly one type tag each
   (`@happy`, `@edge`, `@error`, `@negative`, `@regression`), with at least one
   `@happy`, `@error` and `@regression` per spec. Tag scenarios, or the whole
   `Feature`, `@wip` while they are not automated: they are listed as planned and
   do not fail the check.
3. Ask the `playwright-test-planner` agent to add the `## Test plan` section from
   the scenarios, and review it.
4. Ask the `playwright-test-generator` agent to write the tests. Each file starts
   with `// spec: specs/<feature>.md`, its test title equals the scenario name,
   its describe is tagged `@acceptance`, it calls `test.use(recordEvidence)`, and
   each step is a named `test.step`. Use one browser page per scenario so each
   timeline corresponds to one recording.
5. Ask the `playwright-test-healer` agent to fix failing tests. A test it marks as
   skipped needs a person to decide whether it is a product bug.

CI selects tests with `--grep @acceptance` and matches a scenario to the test
whose `// spec:` header names the spec and whose title equals the scenario name.
Missing, skipped or failed scenarios, absent videos, missing traces and
unavailable timestamps fail the evidence check.

## Running locally

```bash
npm run db:reset -- --scale small
npm run test:e2e -- --grep @acceptance --project=chromium
npm run test:e2e -- tests/e2e/member-registration --reporter=html && npx playwright show-report
```

Recordings are saved under `test-results/`.

## Comment permissions

The acceptance job uses `contents: read` and `pull-requests: write`. Only
same-repository PRs receive a bot comment. Fork and Dependabot PRs keep the
workflow summary and artifacts without attempting a write. A completed run for
an older PR head does not overwrite the current comment. No
`pull_request_target` workflow is used.
