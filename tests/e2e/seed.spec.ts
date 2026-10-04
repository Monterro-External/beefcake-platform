import { test } from '@playwright/test';
import { personaFor, signIn } from './helpers';

/**
 * Starting point for the Playwright planner and generator agents: a seeded
 * database (`npm run db:reset -- --scale small`), the front desk at
 * Puls Träning, and the tenant app open. Plans in `specs/` name this file
 * as their seed; a scenario that needs another persona signs in itself.
 */
test.describe('Seed', () => {
  test('seed', async ({ page, context }) => {
    const receptionist = personaFor('front_desk', 'Puls Träning');
    await signIn(context, receptionist.userId);
    await page.goto('/app');
  });
});
