/**
 * Driving the "Acting as" switcher the way a first-time visitor does.
 *
 * The switcher offers one user per tenant and role, the first by name
 * (`personaOptions()` in `src/lib/session.ts`), which is not the user
 * `personaFor()` picks. So the test reads the offered option from the page.
 */

import type { Page } from '@playwright/test';

/** Choose the tenant's `role` user ("front desk", "member") and return their name. */
export async function chooseInSwitcher(page: Page, tenantName: string, role: string): Promise<string> {
  const switcher = page.getByLabel('Acting as');
  const option = switcher.locator(`optgroup[label="${tenantName}"] > option`, { hasText: `(${role})` }).first();
  const value = await option.getAttribute('value');
  const text = await option.textContent();
  if (value === null || text === null) throw new Error(`No ${role} at ${tenantName} in the switcher`);
  await switcher.selectOption(value);
  return text.replace(/ \([^)]*\)$/, '');
}
