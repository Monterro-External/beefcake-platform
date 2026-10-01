const fs = require('node:fs');
const path = require('node:path');
const { collectSpecs, timestamp } = require('./bdd-timeline.cjs');

const MARKER = '<!-- beefcake-bdd-evidence -->';

function parseBdd(source, filename) {
  const title = source.match(/^# (.+)$/m)?.[1];
  const summary = source.match(/^## Change summary\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1].trim();
  const scenarios = [...source.matchAll(/^- \*\*(AS-\d+) \((happy path|error case|regression)\)\*\*:\s*(.+)$/gm)]
    .map(([, id, kind, text]) => ({ id, kind, text }));
  if (!title || !summary || scenarios.length === 0) {
    throw new Error(`${filename}: expected a title, Change summary and Acceptance scenarios`);
  }
  if (new Set(scenarios.map((scenario) => scenario.id)).size !== scenarios.length
      || ['happy path', 'error case', 'regression'].some((kind) => !scenarios.some((s) => s.kind === kind))
      || scenarios.some((scenario) => !/^Given .+, When .+, Then .+/i.test(scenario.text))) {
    throw new Error(`${filename}: use unique AS ids and Given/When/Then for happy path, error case and regression`);
  }
  return { filename, title, summary, scenarios };
}

function renderReport({ documents, changedFiles, report, timelines = [], testOutcome, artifactUrl, repoUrl, headSha, mergeSha, runUrl, fileExists = fs.existsSync }) {
  const specs = collectSpecs(report?.suites);
  const problems = [];
  const changes = documents.filter((doc) => changedFiles.includes(doc.filename));
  const lines = [MARKER, '## BDD description and browser evidence', '',
    `PR head: \`${headSha}\`. Tested revision: \`${mergeSha}\`.`, '',
    '### What this PR changes — from the BDD', ''];
  if (changes.length === 0) {
    lines.push('No BDD change summary was added or updated in this PR. Update the relevant `docs/testing/*-bdd.md` to describe this change; the scenarios below are existing regression coverage.');
  }
  for (const doc of changes) lines.push(`**${doc.title}**`, '', doc.summary, '');
  lines.push('', `Browser test step: **${testOutcome}**. [Workflow run](${runUrl}).`, '');
  if (artifactUrl) {
    lines.push(`[Download HTML report, videos, traces and BDD documents](${artifactUrl})`, '',
      'Requires repository access. Download and unzip the artifact. Open `test-results/bdd-evidence/index.html` for videos with clickable timestamps, or run `npx playwright show-report playwright-report` for the full report. Artifacts are retained for seven days.', '');
  } else {
    lines.push('**The report artifact is unavailable.** See the workflow logs.', '');
    problems.push('Report artifact missing');
  }
  for (const doc of documents) {
    const sourceUrl = `${repoUrl}/blob/${mergeSha}/${doc.filename}`;
    const testFile = `${path.basename(doc.filename, '-bdd.md')}-ci.spec.ts`;
    lines.push(`### ${doc.title}`, '', `[BDD source](${sourceUrl})`, '');
    for (const scenario of doc.scenarios) {
      const matchingSpecs = specs.filter((spec) => path.basename(spec.file) === testFile && spec.title.startsWith(`${scenario.id}:`));
      const matches = matchingSpecs.flatMap((spec) => spec.tests.filter((test) => test.projectName === 'chromium'));
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
      if (!test || result?.status !== 'passed' || test.expectedStatus !== 'passed' || !video || !trace) {
        problems.push(`${doc.title} / ${scenario.id}: ${status}; video ${video ? 'present' : 'missing'}; trace ${trace ? 'present' : 'missing'}`);
      }
      lines.push(`- **${scenario.id} (${scenario.kind}) — ${status}** · Video: ${video ? 'recorded' : 'missing'} · Trace: ${trace ? 'recorded' : 'missing'}`,
        `  ${scenario.text}`, '');
      if (timeline?.chapters.length) {
        lines.push('| Video time (approx.) | Test step | Test location |', '|---|---|---|');
        const cell = (text) => String(text).replaceAll('|', '\\|').replaceAll('\n', ' ');
        for (const chapter of timeline.chapters) {
          const location = chapter.file && chapter.line
            ? `[${cell(chapter.file)}:${chapter.line}](${repoUrl}/blob/${mergeSha}/${chapter.file}#L${chapter.line})` : '—';
          lines.push(`| ${timestamp(chapter.seconds)} | ${cell(chapter.title)} | ${location} |`);
        }
        lines.push('');
      } else {
        lines.push('**Video timestamps unavailable.**', '');
        problems.push(`${doc.title} / ${scenario.id}: timeline missing`);
      }
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

async function publish({ github, context, core }) {
  const pr = context.payload.pull_request;
  const changedFiles = pr ? (await github.paginate(github.rest.pulls.listFiles, {
    ...context.repo, pull_number: pr.number, per_page: 100,
  })).map((file) => file.filename) : [];
  const documents = [];
  const parseErrors = [];
  for (const file of fs.readdirSync('docs/testing').filter((file) => file.endsWith('-bdd.md')).sort()) {
    const filename = `docs/testing/${file}`;
    try {
      documents.push(parseBdd(fs.readFileSync(filename, 'utf8'), filename));
    } catch (error) {
      parseErrors.push(error.message);
    }
  }
  if (documents.length === 0) parseErrors.push('No valid BDD documents found');
  const reportPath = 'test-results/bdd-results.json';
  const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : undefined;
  const timelinePath = 'test-results/bdd-evidence/chapters.json';
  const timelines = fs.existsSync(timelinePath) ? JSON.parse(fs.readFileSync(timelinePath, 'utf8')) : [];
  const repoUrl = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}`;
  const rendered = renderReport({
    documents, changedFiles, report, timelines,
    testOutcome: process.env.BDD_TEST_OUTCOME || 'not run',
    artifactUrl: process.env.BDD_ARTIFACT_URL,
    repoUrl, headSha: pr?.head.sha ?? context.sha, mergeSha: context.sha,
    runUrl: `${repoUrl}/actions/runs/${context.runId}`,
  });
  const body = rendered.body + (parseErrors.length ? `\n\n### BDD validation errors\n\n${parseErrors.map((error) => `- ${error}`).join('\n')}` : '');
  const problems = [...rendered.problems, ...parseErrors];
  await core.summary.addRaw(body).write();
  const published = await upsertComment({ github, context, body });
  core.info(`BDD PR comment: ${published}`);
  if (problems.length) core.setFailed(`BDD evidence incomplete: ${problems.join('; ')}`);
}

module.exports = { MARKER, parseBdd, renderReport, upsertComment, publish };
