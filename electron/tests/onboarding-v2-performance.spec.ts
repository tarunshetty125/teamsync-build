import { test, expect } from '@playwright/test';

const baseURL = process.env.ONBOARDING_VISUAL_BASE_URL || 'http://localhost:5181';

test('TeamSync Onboarding V2 new user reaches workspace under 90 seconds', async ({ page }) => {
  test.setTimeout(90_000);
  const startedAt = Date.now();

  await page.setViewportSize({ width: 1180, height: 760 });
  await page.goto(`${baseURL}/electron/tests/fixtures/onboarding-v2-visual.html?scenario=new`);
  await completeRequiredNewUserFlow(page);

  const elapsedMs = Date.now() - startedAt;
  expect(elapsedMs).toBeLessThan(90_000);

  const launchState = await page.evaluate(() => ({
    workspaceLaunched: document.body.dataset.workspaceLaunched,
    workspaceLaunchAt: document.body.dataset.workspaceLaunchAt,
    optionalRequested: document.body.dataset.onboardingV2OptionalStateRequested ?? null,
    optionalResolved: document.body.dataset.onboardingV2OptionalStateResolved ?? null,
  }));

  expect(launchState.workspaceLaunched).toBe('true');
  const workspaceLaunchAt = Number(launchState.workspaceLaunchAt);
  expect(workspaceLaunchAt).toBeGreaterThan(0);
  if (launchState.optionalRequested) {
    expect(Number(launchState.optionalRequested)).toBeGreaterThanOrEqual(workspaceLaunchAt);
  }
  if (launchState.optionalResolved) {
    expect(Number(launchState.optionalResolved)).toBeGreaterThanOrEqual(workspaceLaunchAt);
  }

  await expect(page.getByTestId('onboarding-v2-tour')).toBeVisible({ timeout: 2000 });
});

test('TeamSync Onboarding V2 returning user reaches workspace under 10 seconds without personalization', async ({ page }) => {
  test.setTimeout(20_000);
  const startedAt = Date.now();

  await page.setViewportSize({ width: 1180, height: 760 });
  await installBlockedDivObserver(page);
  await page.goto(`${baseURL}/electron/tests/fixtures/onboarding-v2-visual.html?scenario=returning`);

  await expect(page.getByTestId('onboarding-v2-activation')).toBeVisible({ timeout: 5000 });
  await page.getByTestId('onboarding-v2-launch').click();
  await expect(page.locator('body')).toHaveAttribute('data-workspace-launched', 'true');

  const elapsedMs = Date.now() - startedAt;
  expect(elapsedMs).toBeLessThan(10_000);
  await expect.poll(() => (
    page.evaluate(() => Boolean((window as any).__sawBlockedOnboardingV2Div))
  )).toBe(false);

  const launchState = await page.evaluate(() => ({
    workspaceLaunched: document.body.dataset.workspaceLaunched,
    workspaceLaunchAt: document.body.dataset.workspaceLaunchAt,
    optionalRequested: document.body.dataset.onboardingV2OptionalStateRequested ?? null,
    optionalResolved: document.body.dataset.onboardingV2OptionalStateResolved ?? null,
  }));

  expect(launchState.workspaceLaunched).toBe('true');
  const workspaceLaunchAt = Number(launchState.workspaceLaunchAt);
  expect(workspaceLaunchAt).toBeGreaterThan(0);
  if (launchState.optionalRequested) {
    expect(Number(launchState.optionalRequested)).toBeGreaterThanOrEqual(workspaceLaunchAt);
  }
  if (launchState.optionalResolved) {
    expect(Number(launchState.optionalResolved)).toBeGreaterThanOrEqual(workspaceLaunchAt);
  }
});

async function completeRequiredNewUserFlow(page: import('@playwright/test').Page) {
  await expect(page.getByTestId('onboarding-v2-welcome')).toBeVisible();
  await page.waitForTimeout(1050);
  await page.getByRole('button', { name: 'Get Started' }).click();

  await expect(page.getByTestId('onboarding-v2-permissions')).toBeVisible();
  await page.waitForTimeout(1050);
  await page.getByRole('button', { name: 'Enable Screen Understanding' }).click();
  await page.getByRole('button', { name: 'Enable Live Transcription' }).click();
  await page.getByRole('button', { name: 'Enable Interview Assistance' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByTestId('onboarding-v2-oauth')).toBeVisible();
  await page.waitForTimeout(1050);
  await page.getByRole('button', { name: 'Continue with Google' }).click();

  await expect(page.getByTestId('onboarding-v2-persona')).toBeVisible();
  await page.waitForTimeout(1050);
  await page.getByRole('button', { name: /Interview Preparation/ }).click();

  await expect(page.getByTestId('onboarding-v2-industry')).toBeVisible();
  await page.waitForTimeout(1050);
  await page.getByRole('button', { name: 'Engineering' }).click();

  await expect(page.getByTestId('onboarding-v2-discovery')).toBeVisible();
  await page.waitForTimeout(1050);
  await page.getByRole('button', { name: 'Google' }).click();

  await expect(page.getByTestId('onboarding-v2-activation')).toBeVisible({ timeout: 9000 });
  await page.waitForTimeout(1050);
  await page.getByTestId('onboarding-v2-launch').click();
  await expect(page.locator('body')).toHaveAttribute('data-workspace-launched', 'true');
}

async function installBlockedDivObserver(page: import('@playwright/test').Page) {
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
    const observer = new MutationObserver(() => {
      markIfBlocked();
    });
    document.addEventListener('DOMContentLoaded', () => {
      markIfBlocked();
      observer.observe(document.body, { childList: true, subtree: true });
    });
    (window as any).__onboardingV2BlockedObserver = observer;
  });
}
