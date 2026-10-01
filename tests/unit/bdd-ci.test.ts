import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { MARKER, parseBdd, renderReport, upsertComment } = require('../../.github/scripts/bdd-pr-comment.cjs');
const { chaptersFromTrace, timestamp, renderTimeline } = require('../../.github/scripts/bdd-timeline.cjs');
const filename = 'docs/testing/member-registration-bdd.md';
const source = readFileSync(new URL(`../../${filename}`, import.meta.url), 'utf8');
const doc = parseBdd(source, filename);

function input() {
  return {
    documents: [doc], changedFiles: [filename], testOutcome: 'success',
    artifactUrl: 'https://github.com/example/repo/actions/runs/7/artifacts/9',
    repoUrl: 'https://github.com/example/repo', headSha: 'head-sha', mergeSha: 'merge-sha',
    runUrl: 'https://github.com/example/repo/actions/runs/7', fileExists: () => true,
    report: { suites: [{ specs: [1, 2, 3].map((id) => ({
      id: `spec-${id}`, title: `AS-${id}: scenario`, file: 'member-registration-ci.spec.ts',
      tests: [{ projectName: 'chromium', expectedStatus: 'passed', status: 'expected',
        results: [{ status: 'passed', attachments: [
          { contentType: 'video/webm', name: 'video', path: `/video-${id}.webm` },
          { contentType: 'application/zip', name: 'trace', path: `/trace-${id}.zip` },
        ] }],
      }],
    })) }] },
    timelines: [1, 2, 3].map((id) => ({ specId: `spec-${id}`,
      chapters: [{ title: 'Then the result is visible', seconds: 6.7, file: 'tests/e2e/member-registration-ci.spec.ts', line: 40 }],
    })),
  };
}

describe('BDD evidence reporting', () => {
  it('copies the change summary from BDD and matches every scenario to a recording and timestamp', () => {
    const result = renderReport(input());
    expect(result.problems).toEqual([]);
    expect(result.body).toContain(doc.summary);
    expect(result.body).toContain('AS-1 (happy path) — Passed');
    expect(result.body).toContain('00:06.7');
    expect(result.body).toContain('/blob/merge-sha/tests/e2e/member-registration-ci.spec.ts#L40');
    expect(result.body).toContain('artifacts/9');
  });

  it('does not describe unchanged BDD as a change made by another PR', () => {
    const result = renderReport({ ...input(), changedFiles: ['README.md'] });
    expect(result.body).not.toContain(doc.summary);
    expect(result.body).toContain('existing regression coverage');
  });

  it('rejects a BDD without the error case or with duplicate scenario ids', () => {
    expect(() => parseBdd(source.replace(/^.*AS-2.*$/m, ''), filename)).toThrow(/error case/);
    expect(() => parseBdd(source.replace('AS-3', 'AS-1'), filename)).toThrow(/unique AS ids/);
    expect(() => parseBdd(source.replace('## Change summary', '## Other'), filename)).toThrow(/Change summary/);
  });

  it('reports absent results as unverified instead of passed when setup fails', () => {
    const result = renderReport({ ...input(), report: undefined, testOutcome: 'skipped', artifactUrl: '' });
    expect(result.body).toContain('Not verified');
    expect(result.body).not.toContain('— Passed');
    expect(result.problems).toContain('Report artifact missing');
  });

  it('does not accept a same-named scenario from a different test file', () => {
    const data = input();
    data.report.suites[0]!.specs[0]!.file = 'unrelated-ci.spec.ts';
    expect(renderReport(data).body).toContain('AS-1 (happy path) — Not verified');
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
    expect(result.body).toContain('AS-2 (error case) — failed');
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
        stack: [{ file: '/runner/repo/tests/e2e/member-registration-ci.spec.ts', line: 35 }] },
      { type: 'context-options', wallTime: 100_500, monotonicTime: 4000 },
      { type: 'screencast-frame', timestamp: 4500, frameSwapWallTime: 101_000 },
    ].map((event) => JSON.stringify(event)).join('\n');
    expect(chaptersFromTrace(trace)).toEqual([
      { title: 'Given setup', seconds: 0, file: undefined, line: undefined },
      { title: 'When registered', seconds: 2, file: 'tests/e2e/member-registration-ci.spec.ts', line: 35 },
    ]);
    expect(timestamp(60.1)).toBe('01:00.1');
  });

  it('refuses to invent video timestamps when the trace has no recorded frames', () => {
    expect(() => chaptersFromTrace('{}')).toThrow(/missing video frames/);
  });

  it('escapes test titles and creates seek controls rather than executable test content', () => {
    const html = renderTimeline([{ title: '<script>alert(1)</script>', status: 'passed', video: 'videos/AS-1.webm',
      chapters: [{ title: 'Then <button> is visible', seconds: 6.7, file: 'test.ts', line: 8 }],
    }]);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('data-time="6.7"');
    expect(html).toContain('video.currentTime=Number(button.dataset.time)');
  });
});
