import { expect as baseExpect, type PlaywrightTestOptions, type PlaywrightWorkerOptions } from '@playwright/test';

// Next's dev server renders routes on demand; CI needs this budget for both
// navigation and the resulting UI. Assertions still finish as soon as they pass.
export const expect = baseExpect.configure({ timeout: 15_000 });

/**
 * Recording for acceptance scenarios linked from `specs/`: video and trace on
 * every run, including passing ones, so the PR evidence job can build a
 * timeline from the named `test.step` blocks. Use with `test.use(recordEvidence)`.
 */
export const recordEvidence: Partial<PlaywrightTestOptions & PlaywrightWorkerOptions> = {
  actionTimeout: 15_000,
  viewport: { width: 1280, height: 720 },
  video: {
    mode: 'on',
    size: { width: 1280, height: 720 },
    show: {
      actions: { duration: 600, cursor: 'pointer', position: 'top-right', fontSize: 14 },
      test: { level: 'step', position: 'bottom-left', fontSize: 12 },
    },
  },
  trace: 'on',
  // Make the recorded interactions easier to follow without fixed waits in tests.
  launchOptions: { slowMo: 150 },
};
