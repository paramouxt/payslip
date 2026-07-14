import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function expectNoSeriousAccessibilityViolations(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = result.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical'
  );
  expect(serious).toEqual([]);
}

test('sign-in is reachable and has no serious axe violations', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole('heading', { name: 'ShiftSync' })).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
});

test('authenticated primary routes render and pass the accessibility smoke check', async ({
  page,
}) => {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: /Dev sign-in/ }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  for (const route of ['/dashboard', '/shifts', '/payslips', '/inbox', '/settings']) {
    await page.goto(route);
    await expect(page.locator('main')).toBeVisible();
    await expectNoSeriousAccessibilityViolations(page);
  }
});
