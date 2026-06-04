import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function readRepoFile(file: string): string {
  return fs.readFileSync(path.join(repoRoot, file), 'utf8');
}

function sliceFrom(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Expected source to contain ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `Expected source to contain ${end}`);
  return source.slice(startIndex, endIndex);
}

test('Onboarding V2 persists only structured state through SettingsManager', () => {
  const settings = readRepoFile('electron/services/SettingsManager.ts');

  assert.match(settings, /const ONBOARDING_V2_KEY_PREFIX = 'teamsync_onboarding_v2:'/);
  assert.match(settings, /export interface OnboardingV2State/);
  assert.match(settings, /tourComplete:\s*boolean/);
  assert.match(settings, /firstSuccess:\s*\{/);
  assert.match(settings, /action:\s*FirstSuccessActionId \| null/);
  assert.match(settings, /completedAt:\s*string \| null/);
  assert.match(settings, /normalizeOnboardingEmail/);
  assert.match(settings, /\.trim\(\)\.toLowerCase\(\)/);
  assert.match(settings, /getOnboardingV2State\(email: string\)/);
  assert.match(settings, /updateOnboardingV2State\(email: string, patch: unknown\)/);
});

test('Onboarding V2 exposes only narrow IPC and preload methods', () => {
  const ipc = readRepoFile('electron/ipcHandlers.ts');
  const preload = readRepoFile('electron/preload.ts');
  const types = readRepoFile('src/types/electron.d.ts');

  const ipcSlice = sliceFrom(ipc, 'safeHandle("onboarding-v2:get-state"', 'safeHandle("close-settings-window"');
  assert.match(ipcSlice, /onboarding-v2:get-state/);
  assert.match(ipcSlice, /onboarding-v2:update-state/);
  assert.match(ipcSlice, /getOnboardingV2State\(email\)/);
  assert.match(ipcSlice, /updateOnboardingV2State\(email, patch\)/);
  assert.doesNotMatch(ipcSlice, /collection|mongodb|sqlite|localStorage|sessionStorage|new Store/);

  assert.match(preload, /onboardingV2GetState: \(email: string\)/);
  assert.match(preload, /onboardingV2UpdateState: \(email: string, patch: OnboardingV2StatePatch\)/);
  assert.match(types, /onboardingV2GetState: \(email: string\) => Promise<OnboardingV2Result>/);
  assert.match(types, /onboardingV2UpdateState: \(email: string, patch: OnboardingV2StatePatch\) => Promise<OnboardingV2Result>/);
});

test('Premium onboarding renderer does not use forbidden V2 persistence layers', () => {
  const files = [
    'src/components/onboarding/PremiumOnboardingV2.tsx',
    'src/components/onboarding/GuidedProductTour.tsx',
    'src/components/onboarding/FirstSuccessPrompt.tsx',
    'src/components/onboarding/OnboardingV2PostLaunch.tsx',
    'src/components/onboarding/onboardingV2Types.ts',
  ];

  for (const file of files) {
    const source = readRepoFile(file);
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|sqlite|new Store|collection\(/, file);
  }
});

test('Returning users route from authoritative auth user directly to activation', () => {
  const premium = readRepoFile('src/components/onboarding/PremiumOnboardingV2.tsx');
  const routeSlice = sliceFrom(premium, 'const routeAuthenticatedUser', 'const verifyExistingSession');

  assert.match(routeSlice, /user\.onboardingV1\?\.onboardingVersion === 1/);
  assert.match(routeSlice, /transitionToStep\('activation'\)/);
  assert.match(routeSlice, /return;/);
  assert.ok(routeSlice.indexOf("transitionToStep('activation')") < routeSlice.indexOf("transitionToStep('persona')"));
});

test('Workspace launch is independent of tour and first-success state', () => {
  const app = readRepoFile('src/App.tsx');
  const postLaunch = readRepoFile('src/components/onboarding/OnboardingV2PostLaunch.tsx');

  const mountLine = app.match(/const shouldMountLauncherWorkspace = ([^\n]+)/)?.[1] ?? '';
  assert.doesNotMatch(mountLine, /tour|firstSuccess|onboardingV2/i);
  assert.match(app, /shouldMountLauncherWorkspace && renderLauncherWorkspace/);
  assert.match(app, /<OnboardingV2PostLaunch/);

  assert.match(postLaunch, /onboardingV2GetState/);
  assert.match(postLaunch, /if \(!isEnabled \|\| !isLoaded \|\| !state \|\| !user\) return null/);
});

test('Required tour anchors are present on workspace surfaces', () => {
  const launcher = readRepoFile('src/components/Launcher.tsx');
  const search = readRepoFile('src/components/TopSearchPill.tsx');
  const settings = readRepoFile('src/components/SettingsOverlay.tsx');

  assert.match(launcher, /dataTourId="control-center"/);
  assert.match(search, /data-tour-id=\{dataTourId\}/);
  assert.match(launcher, /data-tour-id="overlay-control"/);
  assert.match(launcher, /data-tour-id="interview-mode"/);
  assert.match(launcher, /data-tour-id="settings"/);
  assert.match(settings, /data-tour-id="profile-intelligence"/);
  assert.match(settings, /data-tour-id="settings-audio-provider"/);
  assert.match(settings, /data-tour-id="settings-calendar-sync"/);
  assert.match(settings, /data-tour-id="settings-ai-providers"/);
});
