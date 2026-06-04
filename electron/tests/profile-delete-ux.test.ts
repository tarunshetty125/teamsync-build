import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

const root = process.cwd();

function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

function sliceBetween(source: string, startNeedle: string, endNeedle: string): string {
    const start = source.indexOf(startNeedle);
    assert.notEqual(start, -1, `Missing start marker: ${startNeedle}`);
    const end = source.indexOf(endNeedle, start + startNeedle.length);
    assert.notEqual(end, -1, `Missing end marker: ${endNeedle}`);
    return source.slice(start, end);
}

test('Delete Profile Intelligence action is visible in Profile and Privacy & Trust settings', () => {
    const settings = read('src/components/SettingsOverlay.tsx');
    const deleteCard = sliceBetween(
        settings,
        'const renderDeleteProfileIntelligenceCard',
        'return (',
    );

    assert.match(deleteCard, /data-profile-delete-surface=\{surface\}/);
    assert.match(deleteCard, /Delete Profile Intelligence/);
    assert.match(deleteCard, /onClick=\{openDeleteProfileConfirmation\}/);
    assert.match(settings, /const hasResumeAndJd = profileStatus\.hasProfile && Boolean\(profileData\?\.hasActiveJD\)/);
    assert.match(settings, /hasResumeAndJd && renderDeleteProfileIntelligenceCard\('privacy-trust'\)/);
    assert.match(settings, /hasResumeAndJd && \(\s*<div className="mt-5">\s*\{renderDeleteProfileIntelligenceCard\('profile'\)\}/s);
});

test('Delete Profile Intelligence confirmation names every removed artifact class', () => {
    const settings = read('src/components/SettingsOverlay.tsx');

    assert.match(settings, /role="dialog"/);
    assert.match(settings, /aria-modal="true"/);
    assert.match(settings, /aria-labelledby="delete-profile-intelligence-title"/);
    assert.match(settings, /onClick=\{handleDeleteProfileIntelligence\}/);
    assert.match(settings, /This permanently removes Resume, Job Description, AOT results, Snapshots, Dossiers, Notes, and Profile Intelligence from this device\./);

    for (const artifact of [
        'Resume',
        'Job Description',
        'AOT results',
        'Snapshots',
        'Dossiers',
        'Notes',
        'Profile Intelligence',
    ]) {
        assert.match(settings, new RegExp(`'${artifact}'`));
    }
});

test('Delete Profile Intelligence success path invokes hard delete and refreshes renderer state', () => {
    const settings = read('src/components/SettingsOverlay.tsx');
    const handler = sliceBetween(
        settings,
        'const handleDeleteProfileIntelligence = React.useCallback',
        'const refreshUpdaterCacheInfo',
    );

    assert.match(handler, /profileHardDeleteAll\?\.\('manual-ui'\)/);
    assert.match(handler, /profileHardDeleteUiGuardRef\.current = true/);
    assert.match(handler, /setProfileUploading\(false\)/);
    assert.match(handler, /setJdUploading\(false\)/);
    assert.match(handler, /setCompanyResearching\(false\)/);
    assert.match(handler, /setNegotiationGenerating\(false\)/);
    assert.match(handler, /setProfileData\(null\)/);
    assert.match(handler, /setNegotiationScript\(null\)/);
    assert.match(handler, /setCustomNotes\(''\)/);
    assert.match(handler, /setCompanyResearchToast\(null\)/);
    assert.match(handler, /setLastResumeFileToken\(null\)/);
    assert.match(handler, /setLastJdFileToken\(null\)/);
    assert.match(handler, /setLastUploadKind\(null\)/);
    assert.match(handler, /clearTimeout\(customNotesDebounceRef\.current\)/);
    assert.match(handler, /clearTimeout\(companyResearchToastTimerRef\.current\)/);
    assert.match(handler, /setProfileStatus\(\{\s*hasProfile: false,\s*profileMode: false,\s*isReady: true,/s);
    assert.match(handler, /updateProfileViewStatus\('empty'\)/);
    assert.match(handler, /await refreshProfileStateRef\.current\?\.\(\)/);
    assert.match(handler, /setDeleteProfileConfirmOpen\(false\)/);
    assert.match(handler, /message: 'Profile Intelligence deleted\.'/);
});

test('Delete Profile Intelligence error path shows Delete failed without closing confirmation', () => {
    const settings = read('src/components/SettingsOverlay.tsx');
    const handler = sliceBetween(
        settings,
        'const handleDeleteProfileIntelligence = React.useCallback',
        'const refreshUpdaterCacheInfo',
    );

    assert.match(handler, /throw new Error\(result\?\.error \|\| 'Delete failed'\)/);
    assert.match(handler, /variant: 'error'/);
    assert.match(handler, /message: 'Delete failed'/);
    const errorBlock = sliceBetween(handler, '} catch (error) {', '} finally {');
    assert.doesNotMatch(errorBlock, /setDeleteProfileConfirmOpen\(false\)/);
    assert.match(settings, /role="alert"/);
});

test('Delete Profile Intelligence guards stale renderer events after hard delete', () => {
    const settings = read('src/components/SettingsOverlay.tsx');
    const eventWiring = sliceBetween(
        settings,
        'if (window.electronAPI?.onKnowledgeEngineReady)',
        'return () => {\n            unsubscribers.forEach',
    );

    assert.match(eventWiring, /onProfileResearchUpdated[\s\S]*if \(profileHardDeleteUiGuardRef\.current\) return/);
    assert.match(eventWiring, /onCompanyResearchReady[\s\S]*if \(profileHardDeleteUiGuardRef\.current\) return/);
    assert.match(eventWiring, /onProfileUpdated[\s\S]*if \(profileHardDeleteUiGuardRef\.current && profile\) return/);
});

test('Delete Profile Intelligence renderer bridge uses profile:hard-delete-all IPC', () => {
    const preload = read('electron/preload.ts');
    const electronTypes = read('src/types/electron.d.ts');

    assert.match(preload, /profileHardDeleteAll: \(reason\?: string\) => ipcRenderer\.invoke\('profile:hard-delete-all', reason\)/);
    assert.match(electronTypes, /profileHardDeleteAll: \(reason\?: string\) => Promise<\{ success: boolean; generationId\?: number; reason\?: string; error\?: string \}>/);
});
