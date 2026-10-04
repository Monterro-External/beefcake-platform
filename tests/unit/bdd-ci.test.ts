import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  MARKER, parseGherkin, linkedIssueIds, parseCovers, fetchIssue, resolveSpecs, renderReport, upsertComment,
} = require('../../.github/scripts/bdd-pr-comment.cjs');
const { chaptersFromTrace, timestamp, renderTimeline } = require('../../.github/scripts/bdd-timeline.cjs');

// A copy of the registration Spec's Gherkin stands in for a Spec issue's description.
const gherkin = readFileSync(new URL('./fixtures/registration-spec.md', import.meta.url), 'utf8');
const scenarios = parseGherkin(gherkin, 'BCPLA-142');
const names: string[] = scenarios.map((scenario: { name: string }) => scenario.name);

const specIssue = { identifier: 'BCPLA-142', title: 'Member registration', url: 'https://linear.app/x/BCPLA-142', description: gherkin };
const ticket = (id: string, covers?: string) => ({
  identifier: id, title: `Ticket ${id}`, url: `https://linear.app/x/${id}`,
  description: covers === undefined ? 'Build it.' : `Covers: ${covers}\n\nBuild it.`, parent: specIssue,
});

function input(covers = 'AS-1, AS-2, AS-3') {
  const { specs } = resolveSpecs([ticket('BCPLA-143', covers)]);
  return {
    specs, notes: [], linkedIds: ['BCPLA-143'], testOutcome: 'success',
    artifactUrl: 'https://github.com/example/repo/actions/runs/7/artifacts/9',
    repoUrl: 'https://github.com/example/repo', headSha: 'head-sha', mergeSha: 'merge-sha',
    runUrl: 'https://github.com/example/repo/actions/runs/7', fileExists: () => true,
    report: { suites: [{ specs: [1, 2, 3].map((id) => ({
      id: `spec-${id}`, title: names[id - 1], tags: ['acceptance', 'registration', 'BCPLA-142'],
      file: `member-registration/scenario-${id}.spec.ts`,
      tests: [{ projectName: 'chromium', expectedStatus: 'passed', status: 'expected',
        results: [{ status: 'passed', attachments: [
          { contentType: 'video/webm', name: 'video', path: `/video-${id}.webm` },
          { contentType: 'application/zip', name: 'trace', path: `/trace-${id}.zip` },
        ] }],
      }],
    })) }] },
    timelines: [1, 2, 3].map((id) => ({ specId: `spec-${id}`,
      chapters: [{ title: 'Then the result is visible', seconds: 6.7, file: `tests/e2e/member-registration/scenario-${id}.spec.ts`, line: 40 }],
    })),
  };
}

describe('finding the Spec a PR comes from', () => {
  it('reads ticket ids from the branch, title and body, once each', () => {
    expect(linkedIssueIds({ headRef: 'per/bcpla-143-release-backup', title: 'Fix BCPLA-143', body: 'Also BCPLA-150. Not BCPRO-114.' }))
      .toEqual(['BCPLA-143', 'BCPLA-150']);
    expect(linkedIssueIds({ headRef: 'feature/no-ticket' })).toEqual([]);
  });

  it('reads the Covers line of a ticket', () => {
    expect(parseCovers('Covers: AS-1, as-3\nBody')).toEqual(['AS-1', 'AS-3']);
    expect(parseCovers('**Covers:** AS-2')).toEqual(['AS-2']);
    expect(parseCovers('No line here')).toBeUndefined();
  });

  it('takes the Gherkin from the parent Spec and only the scenarios the ticket covers', () => {
    const { specs, notes } = resolveSpecs([ticket('BCPLA-143', 'AS-1'), ticket('BCPLA-144', 'AS-3')]);
    expect(notes).toEqual([]);
    expect(specs).toHaveLength(1);
    expect(specs[0].id).toBe('BCPLA-142');
    expect([...specs[0].covered]).toEqual(['AS-1', 'AS-3']);
  });

  it('treats a ticket that carries the Gherkin itself as the Spec, covering every scenario', () => {
    const { specs } = resolveSpecs([specIssue]);
    expect([...specs[0].covered]).toEqual(['AS-1', 'AS-2', 'AS-3']);
  });

  it('notes a ticket whose Spec has no Gherkin instead of failing', () => {
    const { specs, notes, errors } = resolveSpecs([{ ...ticket('BCPLA-143', 'AS-1'), parent: { ...specIssue, description: 'Prose only' } }]);
    expect(specs).toEqual([]);
    expect(errors).toEqual([]);
    expect(notes[0]).toMatch(/BCPLA-143 has no Spec with Gherkin/);
  });

  it('asks Linear for the issue and its parent with the API key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { issue: specIssue } }) });
    expect(await fetchIssue('BCPLA-142', 'key', fetchImpl)).toEqual(specIssue);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.linear.app/graphql');
    expect(init.headers.Authorization).toBe('key');
    expect(JSON.parse(init.body).query).toContain('parent { identifier title description url }');
  });
});

describe('BDD evidence reporting', () => {
  it('shows the covered scenarios from the Spec with their recording and timestamps', () => {
    const result = renderReport(input());
    expect(result.problems).toEqual([]);
    expect(result.body).toContain('[BCPLA-143](https://linear.app/x/BCPLA-143) Ticket BCPLA-143: covers AS-1, AS-2, AS-3 of [BCPLA-142]');
    expect(result.body).toContain(`**${names[0]}** (happy path) — Passed`);
    expect(result.body).toContain('  Given a front desk user at Puls Träning');
    expect(result.body).toContain('00:06.7');
    expect(result.body).toContain('/blob/merge-sha/tests/e2e/member-registration/scenario-1.spec.ts#L40');
    expect(result.body).toContain('artifacts/9');
  });

  it('requires evidence only for the scenarios this PR covers', () => {
    const data = input('AS-1');
    data.report.suites[0]!.specs = data.report.suites[0]!.specs.slice(0, 1);
    const result = renderReport(data);
    expect(result.problems).toEqual([]);
    expect(result.body).toContain('not claimed by this PR: AS-2, AS-3');
  });

  it('passes without evidence when no Spec is linked', () => {
    const result = renderReport({ ...input(), specs: [], linkedIds: [], report: undefined, testOutcome: 'skipped' });
    expect(result.problems).toEqual([]);
    expect(result.body).toContain('No BCPLA ticket is linked to this PR');
  });

  it('fails when a ticket covers a scenario the Spec does not have', () => {
    expect(renderReport(input('AS-1, AS-9')).problems).toContain('BCPLA-142: a ticket covers AS-9, which the Spec does not have');
  });

  it('rejects Gherkin without an error case, without ids or without Given/When/Then', () => {
    expect(() => parseGherkin(gherkin.replace('@error', '@happy'), 'X')).toThrow(/at least @happy, @error and @regression/);
    expect(() => parseGherkin(gherkin.replace(names[2]!, names[0]!), 'X')).toThrow(/unique id/);
    expect(() => parseGherkin(gherkin.replace('AS-2 ', ''), 'X')).toThrow(/unique id such as AS-1/);
    expect(() => parseGherkin(gherkin.replace('@regression', ''), 'X')).toThrow(/one type tag per scenario/);
    expect(() => parseGherkin(gherkin.replace(/^    When the person is registered.*$/m, ''), 'X')).toThrow(/Given\/When\/Then/);
    expect(parseGherkin('No gherkin here', 'X')).toBeUndefined();
  });

  it('lists @wip scenarios as planned without failing the evidence check', () => {
    const wip = gherkin.replace('@registration\nFeature', '@registration @wip\nFeature');
    const { specs } = resolveSpecs([{ ...ticket('BCPLA-143'), parent: { ...specIssue, description: wip } }]);
    const result = renderReport({ ...input(), specs, report: { suites: [] }, timelines: [] });
    expect(result.body).toContain('Planned (@wip), not automated yet');
    expect(result.problems).toEqual([]);
  });

  it('lists scenarios without a test as not built yet when the PR links only the Spec', () => {
    const result = renderReport({ ...input(), specs: resolveSpecs([specIssue]).specs, report: { suites: [] }, timelines: [] });
    expect(result.body).toContain(`**${names[0]}** (happy path) — Not built yet: no test tagged @BCPLA-142 with this title`);
    expect(result.problems).toEqual([]);
  });

  it('lists scenarios without a test as not built yet for a ticket without a Covers line', () => {
    const result = renderReport({ ...input(), specs: resolveSpecs([ticket('BCPLA-143')]).specs, report: { suites: [] }, timelines: [] });
    expect(result.body).toContain('Not built yet');
    expect(result.problems).toEqual([]);
  });

  it('fails when a ticket names a scenario on its Covers line and the scenario has no test', () => {
    const result = renderReport({ ...input('AS-1'), report: { suites: [] }, timelines: [] });
    expect(result.body).toContain(`**${names[0]}** (happy path) — Not verified`);
    expect(result.problems.length).toBeGreaterThan(0);
  });

  it('calls nothing unbuilt when the browser run produced no report', () => {
    const result = renderReport({ ...input(), specs: resolveSpecs([specIssue]).specs, report: undefined, testOutcome: 'failure' });
    expect(result.body).not.toContain('Not built yet');
    expect(result.problems).toContain('Browser run did not complete successfully');
  });

  it('fails when a scenario the PR does not name has a test that failed', () => {
    const data = { ...input(), specs: resolveSpecs([specIssue]).specs };
    data.report.suites[0]!.specs[0]!.tests[0]!.results[0]!.status = 'failed';
    expect(renderReport(data).problems.length).toBeGreaterThan(0);
  });

  it('does not accept a same-named test without the Spec tag', () => {
    const data = input();
    data.report.suites[0]!.specs[0]!.tags = ['acceptance', 'registration'];
    expect(renderReport(data).body).toContain(`**${names[0]}** (happy path) — Not verified`);
  });

  it('reports absent results as unverified instead of passed when setup fails', () => {
    const result = renderReport({ ...input(), report: undefined, testOutcome: 'skipped', artifactUrl: '' });
    expect(result.body).toContain('Not verified');
    expect(result.body).not.toContain('— Passed');
    expect(result.problems).toContain('Report artifact missing');
  });

  it('fails evidence validation when a passed scenario has no video or timeline', () => {
    const data = input();
    data.report.suites[0]!.specs[0]!.tests[0]!.results[0]!.attachments = [];
    data.timelines = [];
    const result = renderReport(data);
    expect(result.body).toContain('Video: missing');
    expect(result.body).toContain('Video timestamps unavailable');
    expect(result.problems.length).toBeGreaterThan(0);
  });

  it('keeps flaky and failed runs visible instead of reporting an unqualified pass', () => {
    const data = input();
    data.report.suites[0]!.specs[0]!.tests[0]!.status = 'flaky';
    data.report.suites[0]!.specs[1]!.tests[0]!.results[0]!.status = 'failed';
    const result = renderReport(data);
    expect(result.body).toContain('Passed on retry (flaky)');
    expect(result.body).toContain(`**${names[1]}** (error case) — failed`);
    expect(result.problems.length).toBeGreaterThan(0);
  });
});

function githubFixture() {
  const context = { repo: { owner: 'example', repo: 'repo' }, actor: 'developer',
    payload: { pull_request: { number: 42, head: { sha: 'current', repo: { full_name: 'example/repo' } } } } };
  const github = { paginate: vi.fn().mockResolvedValue([]), rest: {
    pulls: { get: vi.fn().mockResolvedValue({ data: { state: 'open', head: { sha: 'current' } } }) },
    issues: { listComments: vi.fn(), updateComment: vi.fn(), createComment: vi.fn() },
  } };
  return { github, context, body: `${MARKER}\nUpdated evidence` };
}

describe('PR comment lifecycle', () => {
  it('updates the existing Actions comment without replacing human text or adding duplicates', async () => {
    const data = githubFixture();
    data.github.paginate.mockResolvedValue([
      { id: 1, user: { login: 'developer' }, body: MARKER },
      { id: 2, user: { login: 'github-actions[bot]' }, body: MARKER },
    ]);
    expect(await upsertComment(data)).toBe('updated');
    expect(data.github.rest.issues.updateComment).toHaveBeenCalledWith(expect.objectContaining({ comment_id: 2, body: data.body }));
    expect(data.github.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it('creates a comment for the first run', async () => {
    const data = githubFixture();
    expect(await upsertComment(data)).toBe('created');
    expect(data.github.rest.issues.createComment).toHaveBeenCalledWith(expect.objectContaining({ issue_number: 42 }));
  });

  it('does not overwrite current evidence with a run for an older PR head', async () => {
    const data = githubFixture();
    data.github.rest.pulls.get.mockResolvedValue({ data: { state: 'open', head: { sha: 'newer' } } });
    expect(await upsertComment(data)).toBe('superseded');
    expect(data.github.paginate).not.toHaveBeenCalled();
  });

  it('uses the workflow summary without attempting a write for fork PRs', async () => {
    const data = githubFixture();
    data.context.payload.pull_request.head.repo.full_name = 'contributor/fork';
    expect(await upsertComment(data)).toBe('read-only');
    expect(data.github.rest.pulls.get).not.toHaveBeenCalled();
  });
});

describe('video timestamps', () => {
  it('aligns steps to recorded frames across different runner and browser clocks', () => {
    const trace = [
      { type: 'context-options', wallTime: 100_000, monotonicTime: 1000 },
      { type: 'before', method: 'test.step', title: 'Given setup', startTime: 1500 },
      { type: 'before', method: 'test.step', title: 'When registered', startTime: 4000,
        stack: [{ file: '/runner/repo/tests/e2e/member-registration/registration.spec.ts', line: 35 }] },
      { type: 'context-options', wallTime: 100_500, monotonicTime: 4000 },
      { type: 'screencast-frame', timestamp: 4500, frameSwapWallTime: 101_000 },
    ].map((event) => JSON.stringify(event)).join('\n');
    expect(chaptersFromTrace(trace)).toEqual([
      { title: 'Given setup', seconds: 0, file: undefined, line: undefined },
      { title: 'When registered', seconds: 2, file: 'tests/e2e/member-registration/registration.spec.ts', line: 35 },
    ]);
    expect(timestamp(60.1)).toBe('01:00.1');
  });

  it('refuses to invent video timestamps when the trace has no recorded frames', () => {
    expect(() => chaptersFromTrace('{}')).toThrow(/missing video frames/);
  });

  it('escapes test titles and creates seek controls rather than executable test content', () => {
    const html = renderTimeline([{ title: '<script>alert(1)</script>', status: 'passed', video: 'videos/scenario.webm',
      chapters: [{ title: 'Then <button> is visible', seconds: 6.7, file: 'test.ts', line: 8 }],
    }]);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('data-time="6.7"');
    expect(html).toContain('video.currentTime=Number(button.dataset.time)');
  });
});
