import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const baseURL = process.env.ONBOARDING_VISUAL_BASE_URL || 'http://localhost:5181';
const artifactDir = path.resolve(__dirname, '..', '..', 'tmp', 'onboarding-v2-visual');
const motionVideoPath = path.join(artifactDir, 'onboarding-v2-motion.webm');

test.use({
  viewport: { width: 1180, height: 760 },
  video: {
    mode: 'on',
    size: { width: 1180, height: 760 },
  },
});

test('TeamSync Onboarding V2 motion walkthrough recording', async ({ page }) => {
  test.setTimeout(90_000);
  fs.mkdirSync(artifactDir, { recursive: true });
  const video = page.video();

  await page.goto(`${baseURL}/electron/tests/fixtures/onboarding-v2-visual.html?scenario=new`);

  await expect(page.getByTestId('onboarding-v2-welcome')).toBeVisible();
  await page.waitForTimeout(650);
  await page.getByRole('button', { name: 'Get Started' }).click();

  await expect(page.getByTestId('onboarding-v2-permissions')).toBeVisible();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Enable Screen Understanding' }).click();
  await page.waitForTimeout(180);
  await page.getByRole('button', { name: 'Enable Live Transcription' }).click();
  await page.waitForTimeout(180);
  await page.getByRole('button', { name: 'Enable Interview Assistance' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByTestId('onboarding-v2-oauth')).toBeVisible();
  await page.waitForTimeout(650);
  await page.getByRole('button', { name: 'Continue with Google' }).click();

  await expect(page.getByTestId('onboarding-v2-persona')).toBeVisible();
  await page.waitForTimeout(650);
  await page.getByRole('button', { name: /Interview Preparation/ }).click();

  await expect(page.getByTestId('onboarding-v2-industry')).toBeVisible();
  await page.waitForTimeout(650);
  await page.getByRole('button', { name: 'Engineering' }).click();

  await expect(page.getByTestId('onboarding-v2-discovery')).toBeVisible();
  await page.waitForTimeout(650);
  await page.getByRole('button', { name: 'Google' }).click();

  await expect(page.getByTestId('onboarding-v2-building')).toBeVisible();
  await page.waitForTimeout(1200);

  await expect(page.getByTestId('onboarding-v2-activation')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(750);
  await page.getByTestId('onboarding-v2-launch').click();

  await expect(page.locator('body')).toHaveAttribute('data-workspace-launched', 'true');
  await page.waitForTimeout(500);
  await expect(page.getByTestId('onboarding-v2-tour')).toBeVisible({ timeout: 2000 });
  await page.waitForTimeout(650);

  for (let step = 0; step < 7; step += 1) {
    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForTimeout(400);
  }

  await page.getByRole('button', { name: 'Finish tour' }).click();
  await expect(page.getByTestId('onboarding-v2-first-success')).toBeVisible();
  await page.waitForTimeout(900);

  await page.close();
  if (!video) {
    throw new Error('Playwright video recording was not available for motion QA.');
  }
  await video.saveAs(motionVideoPath);
  assertArtifactExists(motionVideoPath);
});

function assertArtifactExists(filePath: string) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`Expected motion artifact at ${filePath}`);
  }
}
