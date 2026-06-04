import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const baseURL = process.env.ONBOARDING_VISUAL_BASE_URL || 'http://127.0.0.1:5181';
const screenshotDir = path.resolve(__dirname, '..', '..', 'tmp', 'onboarding-v1-visual');

test('TeamSync Onboarding V1 reference modal visual contract', async ({ page }) => {
  fs.mkdirSync(screenshotDir, { recursive: true });

  await page.setViewportSize({ width: 846, height: 650 });
  await page.goto(`${baseURL}/electron/tests/fixtures/onboarding-v1-visual.html`);

  const personaModal = page.getByTestId('persona-modal');
  await expect(personaModal).toBeVisible();
  await page.waitForTimeout(700);

  const personaBox = await personaModal.boundingBox();
  expect(personaBox?.width).toBeGreaterThanOrEqual(490);
  expect(personaBox?.width).toBeLessThanOrEqual(505);
  await expect(page.getByTestId('persona-card')).toHaveCount(4);
  await expect(page.getByTestId('persona-card-grid')).toHaveCSS('grid-template-columns', /px .*px/);
  await expect(page.getByRole('button', { name: 'Next' })).toHaveCount(0);

  await page.screenshot({
    path: path.join(screenshotDir, 'persona.png'),
  });

  await page.getByTestId('persona-card').first().click();

  const industryModal = page.getByTestId('industry-modal');
  await expect(industryModal).toBeVisible();
  await page.waitForTimeout(700);

  const industryBox = await industryModal.boundingBox();
  expect(industryBox?.width).toBeGreaterThanOrEqual(490);
  expect(industryBox?.width).toBeLessThanOrEqual(505);
  await expect(page.getByTestId('industry-chip')).toHaveCount(15);
  await expect(page.getByTestId('discovery-chip')).toHaveCount(8);
  await expect(page.getByRole('button', { name: 'Launch' })).toHaveCount(0);

  await page.screenshot({
    path: path.join(screenshotDir, 'industry.png'),
  });

  await page.getByTestId('industry-chip').first().click();
  await page.getByTestId('discovery-chip').first().click();
  await expect(page.locator('body')).toHaveAttribute('data-onboarding-complete', 'true', { timeout: 2000 });
});
