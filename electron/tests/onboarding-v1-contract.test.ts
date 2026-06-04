import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function readRepoFile(file: string): string {
  return fs.readFileSync(path.join(repoRoot, file), 'utf8');
}

function indexOfOrFail(source: string, pattern: string): number {
  const index = source.indexOf(pattern);
  assert.notEqual(index, -1, `Expected source to contain ${pattern}`);
  return index;
}

function sliceBetween(source: string, start: string, end: string): string {
  const startIndex = indexOfOrFail(source, start);
  const endIndex = indexOfOrFail(source, end);
  assert.ok(startIndex < endIndex, `Expected ${start} before ${end}`);
  return source.slice(startIndex, endIndex);
}

test('Onboarding V1 schema includes the Mongo completion shape', () => {
  const mongo = readRepoFile('backend/src/db/mongodb.ts');
  const preload = readRepoFile('electron/preload.ts');
  const bridgeTypes = readRepoFile('src/types/electron.d.ts');
  const modal = readRepoFile('src/components/onboarding/ReferenceOnboardingModal.tsx');
  const credentials = readRepoFile('electron/services/CredentialsManager.ts');

  for (const source of [mongo, preload, bridgeTypes, modal, credentials]) {
    assert.match(source, /persona:\s*string/);
    assert.match(source, /industry:\s*string/);
    assert.match(source, /discoverySource:\s*string/);
    assert.match(source, /completedAt:\s*string/);
    assert.match(source, /onboardingVersion:\s*1/);
    assert.match(source, /completedInVersion:\s*string/);
  }
});

test('Backend onboarding endpoint validates, writes, reloads, and confirms Mongo completion', () => {
  const auth = readRepoFile('backend/src/routes/auth.ts');

  assert.match(auth, /router\.post\('\/onboarding-v1'/);
  assert.match(auth, /authHeader\?\.startsWith\('Bearer '\)/);
  assert.match(auth, /verifyAndGetUser\(token\)/);
  assert.match(auth, /ONBOARDING_V1_PERSONAS\.has\(persona\)/);
  assert.match(auth, /ONBOARDING_V1_INDUSTRIES\.has\(industry\)/);
  assert.match(auth, /ONBOARDING_V1_DISCOVERY_SOURCES\.has\(discoverySource\)/);
  assert.match(auth, /completedInVersion:\s*ONBOARDING_V1_COMPLETED_IN_VERSION/);
  assert.match(auth, /\$set:\s*\{\s*onboardingV1,/s);
  assert.match(auth, /const updatedUser = await users\.findOne\(\{ googleId: user\.googleId \}\)/);
  assert.match(auth, /serializedOnboarding\?\.onboardingVersion !== ONBOARDING_V1_VERSION/);
  assert.match(auth, /success:\s*true,\s*onboardingV1:\s*serializedOnboarding,\s*user:\s*serializeAuthUser\(updatedUser\)/s);
});

test('OAuth flow persists token then calls /auth/me before returning renderer auth state', () => {
  const manager = readRepoFile('electron/services/GoogleAuthManager.ts');

  const persistStart = indexOfOrFail(manager, 'private async persistAuthResult');
  const persistBody = manager.slice(persistStart, indexOfOrFail(manager, 'private async verifySession'));

  const persistTokenIndex = indexOfOrFail(persistBody, 'this.credentials.setGoogleAuthSession(token, user)');
  const fetchMeIndex = indexOfOrFail(persistBody, 'this.fetchAuthoritativeUser(token, user)');
  const updateUserIndex = indexOfOrFail(persistBody, 'this.credentials.updateGoogleAuthUser(authoritativeUser)');

  assert.ok(persistTokenIndex < fetchMeIndex, 'Token must be persisted before /auth/me');
  assert.ok(fetchMeIndex < updateUserIndex, 'Renderer auth state must use the /auth/me user');
  assert.match(manager, /fetch\(`\$\{API_BASE_URL\}\/auth\/me`/);
  assert.doesNotMatch(persistBody, /authState:\s*this\.getAuthState\(user\)/);
});

test('Renderer gates Persona and Industry only on Mongo onboarding version', () => {
  const app = readRepoFile('src/App.tsx');
  const modal = readRepoFile('src/components/onboarding/ReferenceOnboardingModal.tsx');

  assert.match(app, /const hasCompletedMongoOnboarding = authUser\?\.onboardingV1\?\.onboardingVersion === 1/);
  assert.match(app, /!hasCompletedMongoOnboarding/);
  assert.doesNotMatch(app, /POST_LOGIN_LAUNCH_PENDING_KEY/);
  assert.doesNotMatch(app, /pendingPostLoginLaunch/);
  assert.doesNotMatch(app, /googleGetAuthState/);
  assert.doesNotMatch(modal, /localStorage/);
  assert.doesNotMatch(modal, /sessionStorage/);
});

test('Onboarding save payload and completion guard include V1 metadata', () => {
  const manager = readRepoFile('electron/services/GoogleAuthManager.ts');
  const modal = readRepoFile('src/components/onboarding/ReferenceOnboardingModal.tsx');

  assert.match(manager, /onboardingVersion:\s*1/);
  assert.match(manager, /completedInVersion:\s*'1\.0\.0'/);
  assert.match(manager, /body\.onboardingV1/);
  assert.match(manager, /user\.onboardingV1\.onboardingVersion !== 1/);
  assert.match(modal, /onboardingVersion:\s*1/);
  assert.match(modal, /completedInVersion:\s*'1\.0\.0'/);
  assert.match(modal, /result\.user\?\.onboardingV1\?\.onboardingVersion !== 1/);
  assert.match(modal, /const handlePersonaSelect/);
  assert.match(modal, /setStep\('details'\)/);
  assert.match(modal, /const handleIndustrySelect/);
  assert.match(modal, /const handleDiscoverySourceSelect/);
  assert.doesNotMatch(modal, />\s*Next\s*</);
  assert.doesNotMatch(modal, />\s*Saving\.\.\.\s*</);
  assert.match(modal, />\s*Launch TeamSync\s*</);
});

test('Reference modal options, motion, and visual metrics remain locked', () => {
  const modal = readRepoFile('src/components/onboarding/ReferenceOnboardingModal.tsx');

  assert.equal((modal.match(/id:\s*'interview_preparation'/g) || []).length, 1);
  assert.equal((modal.match(/id:\s*'meetings_calls'/g) || []).length, 1);
  assert.equal((modal.match(/id:\s*'developer'/g) || []).length, 1);
  assert.equal((modal.match(/id:\s*'explore_teamsync'/g) || []).length, 1);
  const industryOptions = sliceBetween(modal, 'const INDUSTRY_OPTIONS', 'const DISCOVERY_OPTIONS');
  const discoveryOptions = sliceBetween(modal, 'const DISCOVERY_OPTIONS', 'const exitTransition');
  assert.equal((industryOptions.match(/label:/g) || []).length, 15);
  assert.equal((discoveryOptions.match(/label:/g) || []).length, 8);
  assert.match(modal, /max-w-\[500px\]/);
  assert.match(modal, /grid grid-cols-2/);
  assert.match(modal, /type OnboardingStep = 'waiting' \| 'persona' \| 'details' \| 'complete'/);
  assert.match(modal, /setStep\('waiting'\)/);
  assert.match(modal, /introTimerRef\.current = window\.setTimeout/);
  assert.match(modal, /advanceTimerRef\.current = window\.setTimeout/);
  assert.match(modal, /completeTimerRef\.current = window\.setTimeout/);
  assert.equal((modal.match(/}, 2000\);/g) || []).length, 3);
  assert.match(modal, /const modalEntryState = \{\s*opacity: 0,\s*y: 108,\s*scale: 0\.978,/s);
  assert.match(modal, /const modalVisibleState = \{\s*opacity: 1,\s*y: 0,\s*scale: 1,/s);
  assert.match(modal, /const modalExitState = \{\s*opacity: 0,\s*y: -14,\s*scale: 0\.996,/s);
  assert.match(modal, /const modalVariants:\s*Variants = \{/);
  assert.match(modal, /type:\s*'spring'/);
  assert.match(modal, /duration:\s*0\.96/);
  assert.match(modal, /bounce:\s*0\.18/);
  assert.match(modal, /delayChildren:\s*0\.18/);
  assert.match(modal, /staggerChildren:\s*0\.075/);
  assert.match(modal, /const contentItemVariants:\s*Variants = \{/);
  assert.match(modal, /const contentGroupVariants:\s*Variants = \{/);
  assert.match(modal, /delayChildren:\s*0\.1/);
  assert.match(modal, /staggerChildren:\s*0\.065/);
  assert.match(modal, /initial="hidden"/);
  assert.match(modal, /animate="visible"/);
  assert.match(modal, /exit="exit"/);
  assert.match(modal, /duration:\s*0\.26/);
  assert.doesNotMatch(modal, /filter: 'blur/);
  assert.doesNotMatch(modal, /border-b-transparent/);
  assert.match(modal, /function ModalFrameBorder/);
  assert.match(modal, /WebkitMaskImage:\s*bottomFadeMask/);
  assert.match(modal, /maskImage:\s*bottomFadeMask/);
  assert.match(modal, /bg-gradient-to-b from-transparent to-\[#020202\]/);
  assert.match(modal, /layoutId="persona-selected-highlight"/);
  assert.match(modal, /layoutId="industry-chip-highlight"/);
  assert.match(modal, /layoutId="discovery-chip-highlight"/);
});
