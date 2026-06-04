import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const baseURL = process.env.ONBOARDING_VISUAL_BASE_URL || 'http://localhost:5181';
const screenshotDir = path.resolve(__dirname, '..', '..', 'tmp', 'onboarding-v2-visual');
const settleForFinalFrame = (page: import('@playwright/test').Page) => page.waitForTimeout(1250);

test('TeamSync Onboarding V2 new-user visual flow', async ({ page }) => {
  test.setTimeout(90_000);
  fs.mkdirSync(screenshotDir, { recursive: true });

  await page.setViewportSize({ width: 1180, height: 760 });
  await page.goto(`${baseURL}/electron/tests/fixtures/onboarding-v2-visual.html?scenario=new`);

  await expect(page.getByTestId('onboarding-v2-welcome')).toBeVisible();
  await settleForFinalFrame(page);
  await page.screenshot({ path: path.join(screenshotDir, '01-welcome.png') });

  await page.getByRole('button', { name: 'Get Started' }).click();
  await expect(page.getByTestId('onboarding-v2-permissions')).toBeVisible();
  await settleForFinalFrame(page);
  await page.screenshot({ path: path.join(screenshotDir, '02-permissions.png') });

  await page.getByRole('button', { name: 'Enable Screen Understanding' }).click();
  await page.getByRole('button', { name: 'Enable Live Transcription' }).click();
  await page.getByRole('button', { name: 'Enable Interview Assistance' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByTestId('onboarding-v2-oauth')).toBeVisible();
  await settleForFinalFrame(page);
  await page.screenshot({ path: path.join(screenshotDir, '03-oauth.png') });
  await page.getByRole('button', { name: 'Continue with Google' }).click();

  await expect(page.getByTestId('onboarding-v2-persona')).toBeVisible();
  await settleForFinalFrame(page);
  await page.screenshot({ path: path.join(screenshotDir, '04-persona.png') });
  await page.getByRole('button', { name: /Interview Preparation/ }).click();

  await expect(page.getByTestId('onboarding-v2-industry')).toBeVisible();
  await settleForFinalFrame(page);
  await page.screenshot({ path: path.join(screenshotDir, '05-industry.png') });
  await page.getByRole('button', { name: 'Engineering' }).click();

  await expect(page.getByTestId('onboarding-v2-discovery')).toBeVisible();
  await settleForFinalFrame(page);
  await page.screenshot({ path: path.join(screenshotDir, '06-discovery.png') });
  await page.getByRole('button', { name: 'Google' }).click();

  await expect(page.getByTestId('onboarding-v2-building')).toBeVisible();
  await settleForFinalFrame(page);
  await page.screenshot({ path: path.join(screenshotDir, '07-building.png') });

  await expect(page.getByTestId('onboarding-v2-activation')).toBeVisible({ timeout: 7000 });
  await expect(page.getByText('Resume Intelligence Ready')).toBeVisible();
  await settleForFinalFrame(page);
  await page.screenshot({ path: path.join(screenshotDir, '08-activation.png') });

  await page.getByTestId('onboarding-v2-launch').click();
  await expect(page.locator('body')).toHaveAttribute('data-workspace-launched', 'true');
  await settleForFinalFrame(page);
  await page.screenshot({ path: path.join(screenshotDir, '09-workspace.png') });
  await expect(page.getByTestId('onboarding-v2-tour')).toBeVisible({ timeout: 2000 });
  await settleForFinalFrame(page);
  await page.screenshot({ path: path.join(screenshotDir, '10-guided-tour.png') });

  for (let i = 0; i < 7; i += 1) {
    await page.getByRole('button', { name: 'Next' }).click();
  }
  await page.getByRole('button', { name: 'Finish tour' }).click();
  await expect(page.getByTestId('onboarding-v2-first-success')).toBeVisible();
  await settleForFinalFrame(page);
  await page.screenshot({ path: path.join(screenshotDir, '11-first-success.png') });
});

test('TeamSync Onboarding V2 returning-user skips personalization', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 760 });
  await page.addInitScript(() => {
    const blockedIds = [
      'onboarding-v2-welcome',
      'onboarding-v2-permissions',
      'onboarding-v2-persona',
      'onboarding-v2-industry',
      'onboarding-v2-discovery',
      'onboarding-v2-building',
    ];
    (window as any).__sawBlockedOnboardingV2Div = false;
    const markIfBlocked = () => {
      if (blockedIds.some((id) => Boolean(document.querySelector(`[data-testid="${id}"]`)))) {
        (window as any).__sawBlockedOnboardingV2Div = true;
      }
    };
    const observer = new MutationObserver(markIfBlocked);
    document.addEventListener('DOMContentLoaded', () => {
      markIfBlocked();
      observer.observe(document.body, { childList: true, subtree: true });
    });
    (window as any).__onboardingV2BlockedObserver = observer;
  });
  await page.goto(`${baseURL}/electron/tests/fixtures/onboarding-v2-visual.html?scenario=returning`);

  await expect(page.getByTestId('onboarding-v2-activation')).toBeVisible({ timeout: 5000 });
  await expect.poll(() => (
    page.evaluate(() => Boolean((window as any).__sawBlockedOnboardingV2Div))
  )).toBe(false);
  await expect(page.getByTestId('onboarding-v2-welcome')).toHaveCount(0);
  await expect(page.getByTestId('onboarding-v2-permissions')).toHaveCount(0);
  await expect(page.getByTestId('onboarding-v2-persona')).toHaveCount(0);
  await expect(page.getByTestId('onboarding-v2-industry')).toHaveCount(0);
  await expect(page.getByTestId('onboarding-v2-discovery')).toHaveCount(0);
  await expect(page.getByTestId('onboarding-v2-building')).toHaveCount(0);

  await page.getByTestId('onboarding-v2-launch').click();
  await expect(page.locator('body')).toHaveAttribute('data-workspace-launched', 'true');
});
