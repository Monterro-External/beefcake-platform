const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function collectSpecs(suites = []) {
  return suites.flatMap((suite) => [...(suite.specs ?? []), ...collectSpecs(suite.suites)]);
}

function timestamp(seconds) {
  const tenths = Math.max(0, Math.round(seconds * 10));
  return `${String(Math.floor(tenths / 600)).padStart(2, '0')}:${((tenths % 600) / 10).toFixed(1).padStart(4, '0')}`;
}

// Use the first recorded frame as the video origin, not the test start:
// browser setup can take seconds before recording begins. Trace clocks are
// converted to wall time because the runner and browser may have different origins.
function chaptersFromTrace(trace) {
  let clock;
  let firstFrame = Infinity;
  const steps = [];
  for (const line of trace.split('\n').filter(Boolean)) {
    const event = JSON.parse(line);
    if (event.type === 'context-options') clock = event;
    if (event.type === 'screencast-frame' && Number.isFinite(event.frameSwapWallTime)) {
      firstFrame = Math.min(firstFrame, event.frameSwapWallTime);
    }
    if (event.type === 'before' && event.method === 'test.step' && clock) {
      const location = event.stack?.[0];
      const file = location?.file?.replaceAll('\\', '/');
      steps.push({
        title: event.title,
        wallTime: clock.wallTime + event.startTime - clock.monotonicTime,
        file: file?.includes('/tests/') ? file.slice(file.indexOf('/tests/') + 1) : undefined,
        line: location?.line,
      });
    }
  }
  if (!Number.isFinite(firstFrame) || steps.length === 0 || steps.some((step) => !Number.isFinite(step.wallTime))) {
    throw new Error('Trace is missing video frames or named test steps');
  }
  return steps.map(({ wallTime, ...step }) => ({
    ...step, seconds: Math.max(0, Math.round((wallTime - firstFrame) / 100) / 10),
  }));
}

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function renderTimeline(scenarios) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BDD video evidence</title><style>
body{font:16px system-ui;margin:0;background:#f4f6f8;color:#17212b}main{max-width:1120px;margin:auto;padding:32px}h1{margin-bottom:8px}p{line-height:1.5}section{background:white;border:1px solid #d8dee5;border-radius:12px;padding:24px;margin:24px 0}video{display:block;width:100%;background:#111;border-radius:8px}.steps{display:grid;gap:8px;margin-top:16px}button{text-align:left;background:#f4f6f8;border:1px solid #d8dee5;padding:12px;border-radius:6px;cursor:pointer;font:inherit}button:hover,button:focus{background:#dfeefa}small{display:block;color:#526170;margin-top:4px}code{font-size:14px}
</style><main><h1>BDD video evidence</h1><p>Choose a timestamp to jump to the named test step. Times are approximate video offsets derived from trace frame timing. Some steps verify database state; the video alone does not prove those assertions.</p>
${scenarios.map((scenario, index) => `<section><h2>${escapeHtml(scenario.title)}</h2><p>Status: <strong>${escapeHtml(scenario.status)}</strong></p><video id="video-${index}" controls preload="metadata" src="${escapeHtml(scenario.video)}"></video><div class="steps">${scenario.chapters.map((chapter) => `<button data-video="video-${index}" data-time="${chapter.seconds}"><code>≈${timestamp(chapter.seconds)}</code> ${escapeHtml(chapter.title)}<small>${escapeHtml(chapter.file || '')}${chapter.line ? `:${chapter.line}` : ''}</small></button>`).join('')}</div></section>`).join('')}
</main><script>document.querySelectorAll('button[data-time]').forEach(button=>button.addEventListener('click',()=>{const video=document.getElementById(button.dataset.video);video.currentTime=Number(button.dataset.time);video.play().catch(()=>{});}));</script></html>`;
}

function createTimeline(report, outputDir = 'test-results/bdd-evidence') {
  const scenarios = [];
  const errors = [];
  fs.mkdirSync(path.join(outputDir, 'videos'), { recursive: true });
  for (const spec of collectSpecs(report.suites)) {
    for (const test of spec.tests.filter((item) => item.projectName === 'chromium')) {
      const result = test.results.at(-1);
      const videos = result?.attachments?.filter((item) => item.contentType === 'video/webm' && item.path) ?? [];
      const video = videos.length === 1 ? videos[0].path : undefined;
      const trace = result?.attachments?.find((item) => item.name === 'trace' && item.path)?.path;
      if (!video || !trace) {
        errors.push(`${spec.title}: expected one video and one trace per scenario`);
        continue;
      }
      try {
        const options = { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 10_000 };
        const entries = execFileSync('unzip', ['-Z1', trace], options).split('\n')
          .filter((entry) => entry.endsWith('.trace'));
        // Zip entries need an explicit separator: a trace need not end in a newline.
        const events = entries.map((entry) => execFileSync('unzip', ['-p', trace, entry], options)).join('\n');
        const chapters = chaptersFromTrace(events);
        const filename = `${spec.id.replace(/[^a-zA-Z0-9-]/g, '_')}.webm`;
        fs.copyFileSync(video, path.join(outputDir, 'videos', filename));
        scenarios.push({ specId: spec.id, title: spec.title, status: result.status,
          video: `videos/${filename}`, chapters });
      } catch (error) {
        errors.push(`${spec.title}: ${error.message}`);
      }
    }
  }
  fs.writeFileSync(path.join(outputDir, 'chapters.json'), JSON.stringify(scenarios, null, 2));
  fs.writeFileSync(path.join(outputDir, 'index.html'), renderTimeline(scenarios));
  return { scenarios, errors };
}

if (require.main === module) {
  try {
    const report = JSON.parse(fs.readFileSync('test-results/bdd-results.json', 'utf8'));
    const { scenarios, errors } = createTimeline(report);
    console.log(`Created video timelines for ${scenarios.length} scenarios.`);
    if (scenarios.length === 0 || errors.length) throw new Error(errors.join('\n') || 'No scenarios recorded');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { collectSpecs, timestamp, chaptersFromTrace, renderTimeline, createTimeline };
