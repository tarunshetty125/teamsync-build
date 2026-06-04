import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function readRepoFile(file: string): string {
  return fs.readFileSync(path.join(repoRoot, file), 'utf8');
}

test('Premium Onboarding V2 defines every approved screen and no extra step', () => {
  const source = readRepoFile('src/components/onboarding/PremiumOnboardingV2.tsx');

  for (const step of [
    'welcome',
    'permissions',
    'oauth',
    'persona',
    'industry',
    'discovery',
    'building',
    'activation',
  ]) {
    assert.match(source, new RegExp(`\\| '${step}'`));
  }

  assert.match(source, /testId="onboarding-v2-welcome"/);
  assert.match(source, /testId="onboarding-v2-permissions"/);
  assert.match(source, /(?:testId|data-testid)="onboarding-v2-oauth"/);
  assert.match(source, /(?:testId|data-testid)="onboarding-v2-persona"/);
  assert.match(source, /(?:testId|data-testid)=\{?testId\}?/);
  assert.match(source, /testId="onboarding-v2-industry"/);
  assert.match(source, /testId="onboarding-v2-discovery"/);
  assert.match(source, /testId="onboarding-v2-building"/);
  assert.match(source, /testId="onboarding-v2-activation"/);
});

test('Premium Onboarding V2 uses approved motion timings and layout selections', () => {
  const source = readRepoFile('src/components/onboarding/PremiumOnboardingV2.tsx');

  assert.match(source, /hidden:\s*\{\s*opacity: 0,\s*y: 56\s*\}/);
  assert.match(source, /duration:\s*0\.6/);
  assert.match(source, /exit:\s*\{\s*opacity: 0,\s*y: -12,/);
  assert.match(source, /duration:\s*0\.28/);
  assert.match(source, /advanceExit:\s*\{/);
  assert.match(source, /STEP_HANDOFF_DELAY_MS\s*=\s*2000/);
  assert.match(source, /setTimeout\(\(\) => \{/);
  assert.match(source, /STEP_HANDOFF_DELAY_MS\);/);
  assert.match(source, /layoutId="onboarding-v2-persona-selected"/);
  assert.match(source, /layoutId="onboarding-v2-industry-selected"/);
  assert.match(source, /layoutId="onboarding-v2-discovery-selected"/);
});

test('Activation screen contains only approved persona-specific value copy', () => {
  const source = readRepoFile('src/components/onboarding/PremiumOnboardingV2.tsx');

  assert.match(source, /Resume Intelligence Ready/);
  assert.match(source, /Interview Intelligence Ready/);
  assert.match(source, /Technical Interview Mode Available/);
  assert.match(source, /Coding Assistance Ready/);
  assert.match(source, /Calendar Intelligence Available/);
  assert.match(source, /Live Meeting Assistance Ready/);
  assert.match(source, /Workspace Ready/);
  assert.match(source, /Live Assistance Available/);
  assert.match(source, />\s*Launch TeamSync\s*</);
});

test('Required onboarding screens do not expose skip actions', () => {
  const source = readRepoFile('src/components/onboarding/PremiumOnboardingV2.tsx');
  const requiredFlowSlice = source.slice(
    source.indexOf('export function PremiumOnboardingV2'),
    source.indexOf('return (', source.lastIndexOf('if (!isOpen) return null;')),
  );

  assert.doesNotMatch(requiredFlowSlice, />\s*Skip\s*</);
  assert.doesNotMatch(requiredFlowSlice, /onSkip/);
});

test('Post-launch optional surfaces own skip/completion behavior', () => {
  const tour = readRepoFile('src/components/onboarding/GuidedProductTour.tsx');
  const firstSuccess = readRepoFile('src/components/onboarding/FirstSuccessPrompt.tsx');
  const postLaunch = readRepoFile('src/components/onboarding/OnboardingV2PostLaunch.tsx');

  assert.match(tour, />\s*Skip\s*</);
  assert.match(firstSuccess, />\s*Skip\s*</);
  assert.match(postLaunch, /onSkip=\{markTourComplete\}/);
  assert.match(postLaunch, /onSkip=\{\(\) => markFirstSuccessComplete\(null\)\}/);
});
