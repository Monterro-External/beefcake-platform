import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  MARKER, parseGherkin, linkedIssueIds, parseCovers, fetchIssue, resolveSpecs, specGrep, renderReport, upsertComment,
  withRetry, findLinkedSpecs, publish,
} = require('../../.github/scripts/bdd-pr-comment.cjs');
const { chaptersFromTrace, timestamp, renderTimeline, createTimeline, timelineFailure } = require('../../.github/scripts/bdd-timeline.cjs');

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

  it('gives up on a Linear call that never answers', async () => {
    const hung = (_url: string, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason));
    });
    await expect(fetchIssue('BCPLA-142', 'key', hung, 10)).rejects.toThrow(/timed out|abort/i);
  });
});

describe('choosing which scenarios to record', () => {
  const tagged = (...tags: string[]) => `Some scenario ${tags.join(' ')}`;

  it('records only the @acceptance tests of the linked Specs', () => {
    const grep = new RegExp(specGrep(resolveSpecs([ticket('BCPLA-143', 'AS-1')]).specs));
    expect(grep.test(tagged('@acceptance', '@registration', '@BCPLA-142'))).toBe(true);
    expect(grep.test(tagged('@acceptance', '@booking', '@BCPLA-10'))).toBe(false);
    expect(grep.test(tagged('@registration', '@BCPLA-142'))).toBe(false);
  });

  it('does not take a longer Spec id for a linked one', () => {
    const grep = new RegExp(specGrep([{ id: 'BCPLA-1' }]));
    expect(grep.test(tagged('@acceptance', '@BCPLA-1'))).toBe(true);
    expect(grep.test(tagged('@acceptance', '@BCPLA-10'))).toBe(false);
  });

  it('records several linked Specs in one run', () => {
    const grep = new RegExp(specGrep([{ id: 'BCPLA-10' }, { id: 'BCPLA-36' }]));
    expect(grep.test(tagged('@acceptance', '@BCPLA-10'))).toBe(true);
    expect(grep.test(tagged('@acceptance', '@BCPLA-36'))).toBe(true);
  });

  // findLinkedSpecs saves what it read from Linear for the publish step.
  const selectionPath = () => join(mkdtempSync(join(tmpdir(), 'bdd-selection-')), 'linked.json');
  const outputsOf = () => {
    const outputs: Record<string, string> = {};
    const core = { info: vi.fn(), warning: vi.fn(), setOutput: (key: string, value: string) => { outputs[key] = value; } };
    return { outputs, core };
  };
  const prFor = (title: string) => ({ number: 7, head: { ref: 'per/bcpla-143-registration', sha: 'head-sha', repo: { full_name: 'contributor/fork' } }, title, body: '' });

  it('records nothing when the PR links no Spec', async () => {
    expect(specGrep([])).toBe('');
    const { outputs, core } = outputsOf();
    const context = { repo: { owner: 'o', repo: 'r' }, payload: {} };
    await findLinkedSpecs({ github: {}, context, core, selection: selectionPath() });
    expect(outputs).toEqual({ specs: '', grep: '' });
  });

  it('records nothing and warns when the PR links a ticket but Linear is not configured', async () => {
    vi.stubEnv('LINEAR_API_KEY', undefined);
    try {
      const pr = prFor('Registration');
      const github = { rest: { pulls: { get: vi.fn().mockResolvedValue({ data: pr }) } } };
      const fetchImpl = vi.fn();
      const { outputs, core } = outputsOf();
      await findLinkedSpecs({ github, context: { repo: { owner: 'o', repo: 'r' }, payload: { pull_request: pr } }, core, fetchImpl, selection: selectionPath() });
      expect(outputs).toEqual({ specs: '', grep: '' });
      expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('LINEAR_API_KEY'));
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('reads the linked Specs from Linear for the PR it runs on', async () => {
    vi.stubEnv('LINEAR_API_KEY', 'key');
    try {
      const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { issue: ticket('BCPLA-143', 'AS-1') } }) });
      const pr = prFor('Registration');
      const github = { rest: { pulls: { get: vi.fn().mockResolvedValue({ data: pr }) } } };
      const { outputs, core } = outputsOf();
      await findLinkedSpecs({ github, context: { repo: { owner: 'o', repo: 'r' }, payload: { pull_request: pr } }, core, fetchImpl, selection: selectionPath() });
      expect(outputs.specs).toBe('BCPLA-142');
      expect(new RegExp(outputs.grep!).test('x @acceptance @BCPLA-142')).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('retries a failing call with growing waits and gives up after three tries', async () => {
    const wait = vi.fn().mockResolvedValue(undefined);
    const flaky = vi.fn().mockRejectedValueOnce(new Error('502')).mockResolvedValue('ok');
    expect(await withRetry(flaky, { wait })).toBe('ok');
    const down = vi.fn().mockRejectedValue(new Error('502'));
    await expect(withRetry(down, { wait })).rejects.toThrow('502');
    expect(down).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([1000, 1000, 2000]);
  });

  it('survives a transient GitHub error when reading the PR', async () => {
    vi.stubEnv('LINEAR_API_KEY', 'key');
    try {
      const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { issue: ticket('BCPLA-143', 'AS-1') } }) });
      const pr = prFor('Registration');
      const get = vi.fn().mockRejectedValueOnce(new Error('502')).mockResolvedValue({ data: pr });
      const { outputs, core } = outputsOf();
      await findLinkedSpecs({ github: { rest: { pulls: { get } } }, context: { repo: { owner: 'o', repo: 'r' }, payload: { pull_request: pr } },
        core, fetchImpl, wait: async () => {}, selection: selectionPath() });
      expect(outputs.specs).toBe('BCPLA-142');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('fails the check when the PR links a ticket but Linear cannot be reached', async () => {
    vi.stubEnv('LINEAR_API_KEY', 'key');
    try {
      const selection = selectionPath();
      const fetchImpl = vi.fn().mockRejectedValue(new Error('fetch failed'));
      const pr = prFor('Registration');
      const github = { rest: { pulls: { get: vi.fn().mockResolvedValue({ data: pr }) } } };
      const context = { repo: { owner: 'o', repo: 'r' }, payload: { pull_request: pr }, serverUrl: 'https://github.com', runId: 1, sha: 'merge-sha' };
      const { outputs, core } = outputsOf();
      const find = { ...core, setFailed: vi.fn() };
      await findLinkedSpecs({ github, context, core: find, fetchImpl, wait: async () => {}, selection });
      expect(fetchImpl).toHaveBeenCalledTimes(3);
      expect(outputs).toEqual({ specs: '', grep: '' });
      expect(find.setFailed).toHaveBeenCalledWith(expect.stringMatching(/BCPLA-143 could not be read from Linear/));

      const summary = { addRaw: vi.fn().mockReturnThis(), write: vi.fn() };
      const publishCore = { info: vi.fn(), warning: vi.fn(), setFailed: vi.fn(), summary };
      await publish({ github, context, core: publishCore, fetchImpl, selection });
      expect(publishCore.setFailed).toHaveBeenCalledWith(expect.stringMatching(/BCPLA-143 could not be read from Linear/));
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('publishes the Specs the tests ran for even if the PR changes during the run', async () => {
    vi.stubEnv('LINEAR_API_KEY', 'key');
    try {
      const selection = selectionPath();
      const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { issue: ticket('BCPLA-143', 'AS-1') } }) });
      const pr = prFor('Registration');
      const get = vi.fn().mockResolvedValue({ data: pr });
      const context = { repo: { owner: 'o', repo: 'r' }, payload: { pull_request: pr }, serverUrl: 'https://github.com', runId: 1, sha: 'merge-sha' };
      await findLinkedSpecs({ github: { rest: { pulls: { get } } }, context, core: outputsOf().core, fetchImpl, selection });

      // The ticket is unlinked mid-run: a fresh read would find no Spec.
      get.mockResolvedValue({ data: { ...pr, head: { ...pr.head, ref: 'per/other' } } });
      fetchImpl.mockClear();
      const summary = { addRaw: vi.fn().mockReturnThis(), write: vi.fn() };
      const core = { info: vi.fn(), warning: vi.fn(), setFailed: vi.fn(), summary };
      await publish({ github: { rest: { pulls: { get } } }, context, core, fetchImpl, selection });
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(summary.addRaw.mock.calls[0]![0]).toContain('BCPLA-142');
    } finally {
      vi.unstubAllEnvs();
    }
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

  it('passes with nothing to record when the linked Spec has no runnable tests yet', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bdd-timeline-'));
    try {
      const timeline = createTimeline({ suites: [] }, dir);
      expect(timeline).toEqual({ tested: 0, scenarios: [], errors: [] });
      expect(timelineFailure(timeline)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails when a test that ran left no recording', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bdd-timeline-'));
    try {
      const timeline = createTimeline({ suites: [{ specs: [{ id: 'a1', title: 'Registers a member',
        tests: [{ projectName: 'chromium', results: [{ status: 'passed', attachments: [] }] }] }] }] }, dir);
      expect(timeline.tested).toBe(1);
      expect(timelineFailure(timeline)).toMatch(/expected one video and one trace/);
      expect(timelineFailure({ tested: 1, scenarios: [], errors: [] })).toBe('No scenarios recorded');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
