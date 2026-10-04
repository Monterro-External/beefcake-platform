---
name: spec-to-scenarios
description: Use when a tester wants a Spec ready for Playwright's planner agent. Runs the five questions, adds Gherkin with tags to the Spec and Covers lines to its tickets, checks the test environment, and hands over to the planner.
disable-model-invocation: true
---

# Spec to scenarios

The goal is one thing: a ticket that Playwright's planner agent can plan from, and that the pull request pipeline can turn into a video receipt. If the ticket is already ready, say so and stop. Only fill the gaps that are there.

Start: `/spec-to-scenarios <spec id>`, or `/spec-to-scenarios` followed by the pasted Spec text. Given an implementation ticket instead, the skill works on its parent Spec.

## Which ticket: the Spec, not the implementation tickets

Scenarios describe behaviour, and behaviour lives at the level of the story, not of the technical slices it is built in. So the Gherkin goes on the issue that holds the requirements for one change. Read `docs/agents/issue-tracker.md` to find it. Where the tracker has a Spec (a parent issue with the requirements, and the implementation tickets as its sub-issues), that Spec is "the ticket" everywhere in this skill.

- Given an implementation ticket, open its parent Spec and work there. Say so in one line.
- Each implementation ticket only says which scenarios it makes pass, in one line: `Covers: AS-1, AS-3`.
- One scenario often needs several tickets. It is covered when every ticket it needs is done.

## Where this fits

The team's workflow is one chain:

**Ticket → Criteria → Scenarios → Environment** → Click test → Agents → Pipeline → Video receipt

This skill covers the first four boxes, in that order, as steps 1 to 4, and hands over to the agents. Use the same words as the chain when you talk to the tester, so they always know where they are.

## What you can assume, and what you cannot

- Matt Pocock's skills are installed and his setup has been run. So `docs/agents/issue-tracker.md` says where tickets live, and `docs/agents/domain.md` says where the domain glossary is (`CONTEXT.md`, or `GLOSSARY.md` in newer versions).
- Nothing else about the repo is known. Never assume. Look, and if you cannot find out, ask.

## Rules

- A test can only be as good as the criteria behind it. The acceptance criteria are the requirements. Never invent behaviour.
- Every gap becomes a red card: an open question for the product owner. A person answers a red card, never you.
- Expected results come from the ticket or from the tester's answers, never from what the app does today.
- The Gherkin lives in the ticket. Every other copy is taken from it word for word.
- Never change or remove what the ticket already says. Add to it, and only after the tester says yes.
- Use the words from the domain glossary and the ticket.
- Write no test code. That is the agents' job.
- Talk in the tester's language. Explain any technical word in one plain sentence the first time. Gherkin is the Given, When, Then format for scenarios. Keep messages short.

## 1. Ticket: look around and run the ready check

1. Fetch the ticket through `docs/agents/issue-tracker.md`. If that fails, ask the tester to paste it.
2. Read the domain glossary named in `docs/agents/domain.md`, if it exists.
3. Look in the repo for:
   - a Playwright config, and whether it starts the app itself (`webServer`)
   - a seed test (the starting point the planner and generator agents open: test data ready and the first page loaded, often `tests/seed.spec.ts`)
   - how tests sign in: a setup project that saves the sign-in state (`storageState`) under `playwright/.auth/`, or something simpler such as a test persona
   - where tests run: an app address, a preview per pull request, or a shared test server
   - tags already in use (words starting with `@` in tests, specs or tickets)
   - the Gherkin format the team uses. Look at other tickets with Gherkin, at `.feature` or spec files, and at pipeline files that read scenarios from tickets (search the workflow folder for `Scenario:` or `Given`). Copy the heading, code block, scenario IDs, tags and language.

**The ticket is ready when all of these hold:**

- **Criteria:** every criterion passes the five questions below.
- **Scenarios:** the ticket has Gherkin that covers every criterion, with at least one happy path, one error case and one regression scenario, each with a tag line and a scenario ID.
- **Red cards:** no open question would change an expected result.
- **Environment:** there is a running app to test against and a seed test.

If it is ready, say "This ticket is ready for the planner" and go straight to the handover. Otherwise, work through the steps below, and skip any step that already passes.

## 2. Criteria

Score every criterion on the five questions:

1. **Can a user see it?** "Works correctly" cannot be seen.
2. **Is it specific?** Values, limits, roles, messages.
3. **Does it say what must not happen?**
4. **Does it cover errors?** Wrong input, empty input, missing permissions.
5. **Is it free of vague words?** Fast, easy, correctly, appropriate.

**Stop 1.** Show:

- the story in one sentence
- each criterion as AC1, AC2 and so on, marked OK or with the failed question in a few words
- the red cards: Q1, Q2 and so on

Ask: "Can you answer any of these now? The rest stay as red cards, and no scenario will depend on them."

## 3. Scenarios

The criteria are the rules. The scenarios are the examples that show each rule. Keep any good scenarios already in the ticket, with their IDs. Write new ones only where the ticket is thin. For each criterion that needs them:

- **at least one happy path**
- **the edge cases that matter.** Limits (at the limit, one past it), empty values, duplicates, two users at once, dates and time zones, roles and permissions, a slow or failing backend.
- **at least one error case:** what the user sees when it goes wrong
- **a negative case where it matters:** what must not change
- **one regression scenario** for nearby behaviour the change could break

Every ticket ends up with at least one happy path, one error case and one regression scenario. The pipeline records a video per scenario and fails the pull request without all three.

Each scenario:

- Given, When, Then. One behaviour, about seven lines at most.
- What a person sees and does: "Erik joins the waitlist", not "click the third button".
- Expected results a user can see on the screen: a message, a heading, a status, a value in a field. Name them as the user would read them, so the test can find them by role, label or text instead of by code details.
- Concrete example data, so the expected result is clear.
- Stands alone, with its own data.
- A name that starts with a stable ID, `AS-1`, `AS-2` and so on, unless the team uses another pattern. The ID lets the pipeline match a test and a video to the scenario. Never renumber an existing ID.
- A comment line above it: `# Covers: AC1`.

Written in the language of the team's existing Gherkin, or English if there is none.

Give each scenario a tag line, so groups of tests can be run later. Tags start with `@`. Reuse the team's tags. Otherwise use the four kinds:

| Kind | Default tags | Why |
|---|---|---|
| Ticket | `@<ticket-id>`, the Spec's id where there is one | find every test for one change |
| Area | `@<feature>`, from the glossary, such as `@checkout` | run one feature |
| Type | `@happy`, `@edge`, `@error`, `@negative`, `@regression` | see coverage at a glance |
| When it runs | `@smoke` on two or three must-never-break journeys, `@wip` if not built yet | fast checks on every change, unfinished work kept out |

Use the team's format if you found one. Otherwise use this:

````markdown
## Scenarios

```gherkin
Feature: Waitlist promotion

  # Covers: AC1, AC2
  @BCPLA-142 @booking @happy @smoke
  Scenario: AS-1 Promotion releases the overlapping backup booking
    Given Erik is first on the waitlist for Spin 18:00
    And Erik is booked on Circuit 18:15
    When a spot on Spin frees up
    Then Erik is booked on Spin
    And Erik's booking on Circuit is cancelled
```
````

Three kinds of scenario stay out of the ticket and are listed separately:

- **Waiting for a red card:** marked "Waiting for: Q2". They go in when the question is answered.
- **Extras the ticket does not ask for:** "Extras, need product owner approval".
- **Better as a unit test:** a single rule with no screen involved. Click tests work in the browser, so these go to the developers or to `/tdd`.

**Stop 2.** Show a count per criterion first, for example "AC1: 1 happy, 3 edge, 1 error", then the full Gherkin block exactly as it will look in the ticket. Ask: "Keep, change or remove anything? Any edge case you know from experience that's missing? Which two or three should be `@smoke`?"

On approval, ask: "Shall I add this to <ticket-id>?" On yes, add the block to the ticket description, below the existing text, under the team's heading or `## Scenarios`. If the ticket already has a Gherkin block, update only that block and keep its IDs. If the tracker setup cannot edit a description, say so and give the tester the block to paste. If the tester agrees, post the red cards as a comment on the ticket.

If the ticket is a Spec with sub-issues, propose a `Covers:` line for each sub-issue, as a list: sub-issue, title, scenario IDs. A scenario that no sub-issue covers is a red card. Ask: "Shall I add these Covers lines?" On yes, add each line at the top of the sub-issue's description, or update the existing `Covers:` line.

## 4. Environment

A click test needs something to click on. Check the four things, and fill in what you found in the repo:

- **A running app:** local, a preview per pull request, or a shared test server, and its address
- **Test accounts:** one per role, never real customers
- **Test data:** created and removed by the test itself
- **Outside services:** payment, email, maps and other services the team does not own are never tested for real. Tests replace their answers with fixed ones (Playwright calls this mocking the network), or the app uses a fake.

Then sign-in and the seed test, the Playwright way:

- **Sign-in** happens once, in a setup project, and the saved sign-in state is reused by every test. One saved state per role. It is stored under `playwright/.auth/`, which is in `.gitignore` and never committed.
- **The seed test** is the starting point for the planner and generator agents: it opens the app in the state the scenarios start from.
- **Every test stands alone:** its own data, its own browser context, and it runs in any order. If tests run on a shared test server, they create their own data and clean it up.

**Stop 3.** Show the four things as found or missing. Ask only about what is missing. Anything that blocks the planner today is a blocker, in one plain sentence, for a developer to fix.

## Handover to the agents

Save a brief for the planner, next to the repo's specs or as `specs/<ticket-id>-brief.md`, and say where:

1. Story
2. Acceptance criteria, with the tester's answers added
3. Red cards still open
4. Scenarios: the Gherkin block, copied word for word from the ticket
5. What the planner must not test: unit-level rules, extras not yet approved, scenarios waiting for a red card
6. Environment: the four things, the seed test and any blockers

Give the tester the exact request to paste into the planner agent:

```text
Create a test plan for <ticket-id> from the Gherkin in specs/<ticket-id>-brief.md, using tests/seed.spec.ts as the seed.
Plan one test per scenario, named with its scenario ID, and use each Given, When and Then line as a test step, word for word.
Keep each scenario's tags so the generated tests carry them.
Take expected results from the scenarios, never from what the app does now.
Describe what the user sees (roles, labels, visible text), so the generator can use user-facing locators and web-first assertions.
Write each step so any tester can follow it, and let each test start clean with its own data.
Mock services the team does not own instead of calling them.
List any edge case you find that the scenarios do not cover separately, for QA approval.
```

Adjust the seed path to what the repo has. If there is no seed test or no running app, say plainly that the planner cannot start until a developer adds them.

If the repo has no shared tag list, offer to create `docs/test-tags.md` with one line per tag. That stops synonyms like `@smoke`, `@sanity` and `@quick`. Show how the tags will be used:

```bash
npx playwright test --grep @smoke                        # quick check on every change
npx playwright test --grep @checkout                     # one feature
npx playwright test --grep "(?=.*@checkout)(?=.*@edge)"  # checkout AND edge cases
npx playwright test --grep-invert @wip                   # everything except unfinished work
```

End with where the tester is in the chain, in four lines:

- **Ticket, criteria, scenarios, environment:** ready or not, and whether the Gherkin is in the ticket
- **Red cards:** how many remain open
- **Agents, next:** run the planner and approve its plan before the generator writes any test. The healer may fix the route, never the expectation.
- **Pipeline and video receipt:** each scenario gets its own video in the pull request, with chapters named after its Given, When and Then lines in the ticket
