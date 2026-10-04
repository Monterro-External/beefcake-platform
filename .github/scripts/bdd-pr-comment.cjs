const fs = require('node:fs');
const { collectSpecs, timestamp } = require('./bdd-timeline.cjs');

const MARKER = '<!-- beefcake-bdd-evidence -->';
const TEAM_KEY = 'BCPLA';

// Type tags from docs/test-tags.md; each Spec needs at least one happy, error and regression scenario.
const KINDS = { happy: 'happy path', edge: 'edge case', error: 'error case', negative: 'negative case', regression: 'regression' };
const REQUIRED_KINDS = ['happy path', 'error case', 'regression'];

// The Gherkin lives on the BCPLA Spec issue, the parent of the implementation
// tickets (docs/agents/issue-tracker.md). A ticket names the scenarios it makes
// pass with a `Covers: AS-1, AS-3` line. Tests carry the Spec as a tag and the
// scenario name, id included, as their title.
function parseGherkin(text, label) {
  const gherkin = text.match(/^```gherkin\s*\n([\s\S]*?)^```/m)?.[1];
  if (gherkin === undefined) return undefined;
  const scenarios = [];
  let pending = [];
  let featureTags = [];
  let current;
  for (const raw of gherkin.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('@')) {
      pending.push(...line.split(/\s+/).map((tag) => tag.slice(1)));
    } else if (/^Feature:/.test(line)) {
      featureTags = pending;
      pending = [];
    } else if (/^Scenario( Outline)?:/.test(line)) {
      const tags = [...featureTags, ...pending];
      const kinds = tags.filter((tag) => tag in KINDS);
      const name = line.replace(/^Scenario( Outline)?:\s*/, '');
      current = { id: name.match(/^(AS-\d+) /)?.[1], name, kind: kinds.length === 1 ? KINDS[kinds[0]] : undefined,
        kindTags: kinds.length, wip: tags.includes('wip'), steps: [] };
      scenarios.push(current);
      pending = [];
    } else if (/^Background:/.test(line)) {
      current = undefined;
    } else if (current && /^(Given|When|Then|And|But) /.test(line)) {
      current.steps.push(line);
    }
  }
  if (scenarios.length === 0) throw new Error(`${label}: the gherkin block has no scenarios`);
  const ids = scenarios.map((scenario) => scenario.id);
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    throw new Error(`${label}: start every scenario name with a unique id such as AS-1, so tickets can say which scenarios they cover`);
  }
  if (new Set(scenarios.map((scenario) => scenario.name)).size !== scenarios.length
      || scenarios.some((scenario) => scenario.kindTags !== 1)
      || REQUIRED_KINDS.some((kind) => !scenarios.some((s) => s.kind === kind))
      || scenarios.some(({ steps }) => !['Given', 'When', 'Then'].every((word) => steps.some((step) => step.startsWith(`${word} `))))) {
    throw new Error(`${label}: use unique scenario names, one type tag per scenario (docs/test-tags.md), at least @happy, @error and @regression, and Given/When/Then steps`);
  }
  return scenarios.map(({ kindTags, ...scenario }) => scenario);
}

/** Ticket ids named in the PR's branch, title or body, in order of first mention. */
function linkedIssueIds({ headRef = '', title = '', body = '' }, teamKey = TEAM_KEY) {
  const found = `${headRef}\n${title}\n${body}`.match(new RegExp(`\\b${teamKey}-\\d+\\b`, 'gi')) ?? [];
  return [...new Set(found.map((id) => id.toUpperCase()))];
}

/** The scenario ids on a ticket's `Covers:` line, or undefined when it has none. */
function parseCovers(description = '') {
  const line = description.match(/^\W*Covers:\s*(.+)$/im)?.[1];
  return line === undefined ? undefined : [...new Set(line.match(/AS-\d+/gi)?.map((id) => id.toUpperCase()) ?? [])];
}

const ISSUE_QUERY = `query Issue($id: String!) {
  issue(id: $id) { identifier title description url parent { identifier title description url } }
}`;

async function fetchIssue(id, apiKey, fetchImpl = fetch) {
  const response = await fetchImpl('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: apiKey },
    body: JSON.stringify({ query: ISSUE_QUERY, variables: { id } }),
  });
  if (!response.ok) throw new Error(`Linear answered ${response.status} for ${id}`);
  const json = await response.json();
  if (json.errors?.length) throw new Error(`Linear: ${json.errors.map((error) => error.message).join('; ')} (${id})`);
  return json.data?.issue ?? undefined;
}

/**
 * Group the PR's tickets by the Spec that holds their Gherkin: a ticket's parent,
 * or the ticket itself when it carries the Gherkin. A ticket without a Covers
 * line claims every scenario of its Spec.
 */
function resolveSpecs(issues) {
  const specs = new Map();
  const notes = [];
  const errors = [];
  for (const issue of issues) {
    const candidate = issue.parent && parseGherkinSafe(issue.parent, errors) !== undefined ? issue.parent : issue;
    const scenarios = parseGherkinSafe(candidate, errors);
    if (scenarios === undefined) {
      notes.push(`${issue.identifier} has no Spec with Gherkin${issue.parent ? ` (its parent ${issue.parent.identifier} has none either)` : ''}.`);
      continue;
    }
    if (scenarios === null) continue;
    const spec = specs.get(candidate.identifier)
      ?? { id: candidate.identifier, title: candidate.title, url: candidate.url, scenarios, covered: new Set(), tickets: [] };
    const covers = candidate === issue ? undefined : parseCovers(issue.description);
    for (const id of covers ?? scenarios.map((scenario) => scenario.id)) spec.covered.add(id);
    spec.tickets.push({ id: issue.identifier, title: issue.title, url: issue.url, covers });
    specs.set(spec.id, spec);
  }
  return { specs: [...specs.values()], notes, errors };
}

// undefined: no gherkin block; null: a block that does not validate (reported in errors).
function parseGherkinSafe(issue, errors) {
  try {
    return parseGherkin(issue.description ?? '', issue.identifier);
  } catch (error) {
    if (!errors.includes(error.message)) errors.push(error.message);
    return null;
  }
}

function evidenceFor(scenario, spec, specs, timelines, fileExists) {
  const tag = spec.id.toLowerCase();
  const matchingSpecs = specs.filter((item) => item.title === scenario.name
    && (item.tags ?? []).some((t) => t.replace(/^@/, '').toLowerCase() === tag));
  const matches = matchingSpecs.flatMap((item) => item.tests.filter((test) => test.projectName === 'chromium'));
  const test = matches.length === 1 ? matches[0] : undefined;
  const timeline = matchingSpecs.length === 1 ? timelines.find((item) => item.specId === matchingSpecs[0].id) : undefined;
  const result = test?.results.at(-1);
  const video = result?.attachments?.some((a) => a.contentType === 'video/webm' && a.path && fileExists(a.path));
  const trace = result?.attachments?.some((a) => a.name === 'trace' && a.path && fileExists(a.path));
  let status = 'Not verified';
  if (result?.status === 'passed' && test.expectedStatus === 'passed') {
    status = test.status === 'flaky' ? 'Passed on retry (flaky)' : 'Passed';
  } else if (result) {
    status = result.status;
  }
  const ok = test !== undefined && result?.status === 'passed' && test.expectedStatus === 'passed' && video && trace;
  return { status, video, trace, timeline, ok };
}

function renderReport({ specs: linked, notes = [], linkedIds = [], report, timelines = [], testOutcome, artifactUrl, repoUrl, headSha, mergeSha, runUrl,
  fileExists = fs.existsSync }) {
  const tests = collectSpecs(report?.suites);
  const problems = [];
  const lines = [MARKER, '## BDD description and browser evidence', '',
    `PR head: \`${headSha}\`. Tested revision: \`${mergeSha}\`.`, ''];

  if (linked.length === 0) {
    lines.push(linkedIds.length === 0
      ? `No ${TEAM_KEY} ticket is linked to this PR, so there are no scenarios to show. Name the ticket (\`${TEAM_KEY}-123\`) in the branch, title or description.`
      : `The linked tickets (${linkedIds.join(', ')}) have no Spec with Gherkin scenarios yet.`, '');
    for (const note of notes) lines.push(`- ${note}`);
    if (notes.length) lines.push('');
    return { body: lines.join('\n'), problems };
  }

  lines.push('### What this PR covers', '');
  for (const spec of linked) {
    for (const ticket of spec.tickets) {
      const claim = ticket.covers === undefined ? 'every scenario' : (ticket.covers.join(', ') || 'no scenarios');
      lines.push(`- [${ticket.id}](${ticket.url}) ${ticket.title}: covers ${claim} of [${spec.id}](${spec.url})`);
    }
  }
  for (const note of notes) lines.push(`- ${note}`);
  lines.push('', `Browser test step: **${testOutcome}**. [Workflow run](${runUrl}).`, '');
  if (artifactUrl) {
    lines.push(`[Download HTML report, videos and traces](${artifactUrl})`, '',
      'Requires repository access. Download and unzip the artifact. Open `test-results/bdd-evidence/index.html` for videos with clickable timestamps, or run `npx playwright show-report playwright-report` for the full report. Artifacts are retained for seven days.', '');
  } else {
    lines.push('**The report artifact is unavailable.** See the workflow logs.', '');
    problems.push('Report artifact missing');
  }

  const cell = (text) => String(text).replaceAll('|', '\\|').replaceAll('\n', ' ');
  for (const spec of linked) {
    lines.push(`### [${spec.id}](${spec.url}) ${spec.title}`, '');
    const known = new Set(spec.scenarios.map((scenario) => scenario.id));
    for (const id of spec.covered) {
      if (!known.has(id)) problems.push(`${spec.id}: a ticket covers ${id}, which the Spec does not have`);
    }
    const others = [];
    for (const scenario of spec.scenarios) {
      if (!spec.covered.has(scenario.id)) {
        others.push(scenario);
        continue;
      }
      if (scenario.wip) {
        lines.push(`- **${scenario.name}** (${scenario.kind}) — Planned (@wip), not automated yet`, '');
        continue;
      }
      const evidence = evidenceFor(scenario, spec, tests, timelines, fileExists);
      if (!evidence.ok) {
        problems.push(`${spec.id} / ${scenario.name}: ${evidence.status}; video ${evidence.video ? 'present' : 'missing'}; trace ${evidence.trace ? 'present' : 'missing'}`);
      }
      lines.push(`- **${scenario.name}** (${scenario.kind}) — ${evidence.status} · Video: ${evidence.video ? 'recorded' : 'missing'} · Trace: ${evidence.trace ? 'recorded' : 'missing'}`,
        ...scenario.steps.map((step) => `  ${step}  `), '');
      if (evidence.timeline?.chapters.length) {
        lines.push('| Video time (approx.) | Test step | Test location |', '|---|---|---|');
        for (const chapter of evidence.timeline.chapters) {
          const location = chapter.file && chapter.line
            ? `[${cell(chapter.file)}:${chapter.line}](${repoUrl}/blob/${mergeSha}/${chapter.file}#L${chapter.line})` : '—';
          lines.push(`| ${timestamp(chapter.seconds)} | ${cell(chapter.title)} | ${location} |`);
        }
        lines.push('');
      } else if (evidence.ok || evidence.status !== 'Not verified') {
        lines.push('**Video timestamps unavailable.**', '');
        problems.push(`${spec.id} / ${scenario.name}: timeline missing`);
      }
    }
    if (others.length) {
      lines.push(`Other scenarios in ${spec.id}, not claimed by this PR: ${others.map((scenario) => scenario.id).join(', ')}.`, '');
    }
  }
  if (!report || report.errors?.length || testOutcome !== 'success') problems.push('Browser run did not complete successfully');
  lines.push('Videos demonstrate visible application behaviour. Database-only assertions are documented separately in the test report.');
  return { body: lines.join('\n'), problems };
}

async function upsertComment({ github, context, body }) {
  const pr = context.payload.pull_request;
  if (!pr || pr.head.repo.full_name !== `${context.repo.owner}/${context.repo.repo}` || context.actor === 'dependabot[bot]') return 'read-only';
  const latest = await github.rest.pulls.get({ ...context.repo, pull_number: pr.number });
  if (latest.data.state !== 'open' || latest.data.head.sha !== pr.head.sha) return 'superseded';
  const comments = await github.paginate(github.rest.issues.listComments, { ...context.repo, issue_number: pr.number, per_page: 100 });
  const existing = comments.find((comment) => comment.user?.login === 'github-actions[bot]' && comment.body?.startsWith(MARKER));
  if (existing) {
    await github.rest.issues.updateComment({ ...context.repo, comment_id: existing.id, body });
    return 'updated';
  }
  await github.rest.issues.createComment({ ...context.repo, issue_number: pr.number, body });
  return 'created';
}

async function publish({ github, context, core, fetchImpl = fetch }) {
  const pr = context.payload.pull_request;
  const linkedIds = linkedIssueIds({ headRef: pr?.head.ref, title: pr?.title, body: pr?.body ?? '' });
  const apiKey = process.env.LINEAR_API_KEY;
  const issues = [];
  const notes = [];
  if (linkedIds.length && !apiKey) {
    notes.push('Linear is not configured for this run (no `LINEAR_API_KEY`), so the linked tickets could not be read.');
    core.warning('LINEAR_API_KEY is not set; scenarios were not read from Linear.');
  }
  if (apiKey) {
    for (const id of linkedIds) {
      try {
        const issue = await fetchIssue(id, apiKey, fetchImpl);
        if (issue) issues.push(issue); else notes.push(`${id} was not found in Linear.`);
      } catch (error) {
        notes.push(`${id} could not be read from Linear: ${error.message}`);
        core.warning(error.message);
      }
    }
  }
  const resolved = resolveSpecs(issues);
  const reportPath = 'test-results/bdd-results.json';
  const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : undefined;
  const timelinePath = 'test-results/bdd-evidence/chapters.json';
  const timelines = fs.existsSync(timelinePath) ? JSON.parse(fs.readFileSync(timelinePath, 'utf8')) : [];
  const repoUrl = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}`;
  const rendered = renderReport({
    specs: resolved.specs, notes: [...notes, ...resolved.notes], linkedIds, report, timelines,
    testOutcome: process.env.BDD_TEST_OUTCOME || 'not run',
    artifactUrl: process.env.BDD_ARTIFACT_URL,
    repoUrl, headSha: pr?.head.sha ?? context.sha, mergeSha: context.sha,
    runUrl: `${repoUrl}/actions/runs/${context.runId}`,
  });
  const body = rendered.body + (resolved.errors.length ? `\n\n### Spec validation errors\n\n${resolved.errors.map((error) => `- ${error}`).join('\n')}` : '');
  const problems = [...rendered.problems, ...resolved.errors];
  await core.summary.addRaw(body).write();
  const published = await upsertComment({ github, context, body });
  core.info(`BDD PR comment: ${published}`);
  if (problems.length) core.setFailed(`BDD evidence incomplete: ${problems.join('; ')}`);
}

module.exports = {
  MARKER, parseGherkin, linkedIssueIds, parseCovers, fetchIssue, resolveSpecs, renderReport, upsertComment, publish,
};
