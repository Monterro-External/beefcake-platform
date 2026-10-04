# Specs

Test plans in the Playwright Test Agents layout: one Markdown file per feature,
read by the planner and generator agents. The Gherkin lives in the feature's
BCPLA Spec issue, and the PR evidence job in CI reads it from there, not from
these files. See `docs/testing/pr-evidence.md` for the format and how CI uses it.
