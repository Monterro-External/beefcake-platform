# BDD evidence on pull requests

Every opened, updated or reopened PR runs the BDD browser scenarios in Chromium.
One bot comment is created or updated with:

- The change summary copied from BDD documents added or updated in the PR.
- Each acceptance scenario and its actual result, including failures and retries.
- A link to the private CI artifact containing reports, recordings and BDD documents.
- Approximate video timestamps, named test steps and links to the tested source lines.

The PR's human-written body is preserved. If no BDD document changed, the comment
says so and labels the tested scenarios as existing regression coverage. It does
not describe an unrelated PR as a registration feature change.

## Adding a feature

1. Write `docs/testing/<feature>-bdd.md` in English with a title, a `Change summary`
   describing what this PR actually changes, and `Acceptance scenarios`.
2. Include unique `AS-1`, `AS-2`, etc. entries covering `happy path`, `error case`
   and `regression`, using declarative Given / When / Then wording.
3. Implement `tests/e2e/<feature>-ci.spec.ts`. Start each test title with its
   scenario id followed by a colon, and use named `test.step` blocks. Use one
   browser page per scenario so each timeline corresponds to one recording.
4. Record video and trace on every run, including passing tests. The registration
   example shows the file-level `test.use` configuration.

CI selects tests by `AS-[0-9]+:` and matches each BDD scenario to the corresponding
`<feature>-ci.spec.ts` test. Missing, skipped or failed scenarios, absent videos,
missing traces and unavailable timestamps fail the evidence check.

## Watching a specific step

Download and unzip the linked artifact. Open
`test-results/bdd-evidence/index.html` for a player with clickable chapter times,
or run `npx playwright show-report playwright-report` for Playwright's report.
The artifact is retained for seven days and requires repository access.

Offsets are generated from the recorded trace's first video frame and named step
times, adjusting for the runner and browser clocks. They are approximate to a
tenth of a second, not hardcoded timings. Each video has its own zero point.
Source links point to the exact tested merge revision.

Videos show visible UI behaviour. Database-only checks remain assertions in the
test report. CI verifies test/recording/timeline presence; it does not judge whether
arbitrary release-note prose is visually proven.

## Comment permissions

The BDD job uses `contents: read` and `pull-requests: write`. Only same-repository
PRs receive a bot comment. Fork and Dependabot PRs retain the workflow summary and
artifacts without attempting a write. A completed run for an older PR head does
not overwrite the current comment. No `pull_request_target` workflow is used.
