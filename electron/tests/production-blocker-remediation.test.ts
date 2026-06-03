const { test: remediationTest }: typeof import('node:test') = require('node:test');
const remediationAssert: typeof import('node:assert').strict = require('node:assert').strict;
const remediationFs: typeof import('node:fs') = require('node:fs');
const remediationPath: typeof import('node:path') = require('node:path');

const { redactForPersistentLog } = require('../utils/safeLogging') as typeof import('../utils/safeLogging');

const remediationRepoRoot = remediationPath.resolve(__dirname, '..', '..');

function readRemediationRepoFile(file: string): string {
    return remediationFs.readFileSync(remediationPath.join(remediationRepoRoot, file), 'utf8');
}

remediationTest('screen scan reuses request lifecycle instead of self-cancelling nested runAction', () => {
    const engine = readRemediationRepoFile('electron/IntelligenceEngine.ts');
    const screenStart = engine.indexOf('async runScreenScan');
    const screenBody = engine.slice(screenStart);

    remediationAssert.match(engine, /requestAbortRefCounts/);
    remediationAssert.match(engine, /reuseExistingController/);
    remediationAssert.match(screenBody, /reuseRequestLifecycle: true/);
    remediationAssert.doesNotMatch(screenBody, /setKnowledgeOrchestrator\(null\)/);
    remediationAssert.match(screenBody, /\[SCREEN_SCAN_LIFECYCLE\]/);
});

remediationTest('routing decisions are immutable and preserve custom, curl, and ollama routes', () => {
    const helper = readRemediationRepoFile('electron/LLMHelper.ts');

    remediationAssert.match(helper, /export type RouteDecision = Readonly<RoutingDecision>/);
    remediationAssert.match(helper, /Object\.freeze\(\{ \.\.\.route \}\)/);
    remediationAssert.match(helper, /\[ROUTE_DECISION\]/);
    remediationAssert.match(helper, /this\.useOllama && normalized === this\.normalizeModelId\(this\.ollamaModel\)/);
    remediationAssert.match(helper, /const routeCustomProvider = routeProvider === 'custom'/);
    remediationAssert.match(helper, /const routeCurlProvider = routeProvider === 'custom'/);
    remediationAssert.match(helper, /\[PROVIDER_INVOKE\] provider=ollama/);
});

remediationTest('persistent log redaction removes screen, transcript, content, and token material', () => {
    const redacted = redactForPersistentLog([
        '[OCR_SCAN] secret screen words [OCR_SCAN_END]',
        'Transcript (final): "candidate private answer"',
        '{"text":"this is a long private meeting sentence that should not hit disk"}',
        'Authorization: bearer sk-secret-token',
    ].join('\n'));

    remediationAssert.doesNotMatch(redacted, /secret screen words/);
    remediationAssert.doesNotMatch(redacted, /candidate private answer/);
    remediationAssert.doesNotMatch(redacted, /long private meeting sentence/);
    remediationAssert.doesNotMatch(redacted, /sk-secret-token/);
    remediationAssert.match(redacted, /REDACTED/);
});

remediationTest('mermaid renderer does not use unsafe html injection', () => {
    const renderer = readRemediationRepoFile('src/components/ui/MermaidRenderer.tsx');

    remediationAssert.doesNotMatch(renderer, /dangerouslySetInnerHTML/);
    remediationAssert.match(renderer, /securityLevel: 'strict'/);
    remediationAssert.match(renderer, /htmlLabels: false/);
    remediationAssert.match(renderer, /sanitizeSvgMarkup/);
    remediationAssert.match(renderer, /data:image\/svg\+xml/);
});

remediationTest('mac packaging enables hardened runtime and removes dyld entitlement', () => {
    const pkg = JSON.parse(readRemediationRepoFile('package.json'));
    const entitlements = readRemediationRepoFile('assets/entitlements.mac.plist');
    const signingScript = readRemediationRepoFile('scripts/ad-hoc-sign.js');

    remediationAssert.equal(pkg.build.mac.hardenedRuntime, true);
    remediationAssert.notEqual(pkg.build.mac.identity, null);
    remediationAssert.equal(pkg.build.mac.entitlements, 'assets/entitlements.mac.plist');
    remediationAssert.equal(pkg.build.mac.entitlementsInherit, 'assets/entitlements.mac.inherit.plist');
    remediationAssert.doesNotMatch(entitlements, /allow-dyld-environment-variables/);
    remediationAssert.match(signingScript, /--options runtime/);
    remediationAssert.match(signingScript, /codesign --verify --strict --deep/);
});

remediationTest('system design validator reports repairable architecture json issues without fabricating output', () => {
    const validator = readRemediationRepoFile('electron/ActionOutputValidator.ts');

    remediationAssert.doesNotMatch(validator, /function buildSystemDesignArchitectureDiagram/);
    remediationAssert.doesNotMatch(validator, /appendArchitectureJsonFallback/);
    remediationAssert.doesNotMatch(validator, /system_design_architecture_json_appended/);
    remediationAssert.doesNotMatch(validator, /Interview-Ready Final Answer\\nI would design/);
    remediationAssert.match(validator, /issues: architectureJson\.issues/);
    remediationAssert.match(validator, /const architectureJsonRepair = intent !== 'system_design_tradeoffs' && issues\.some\(isArchitectureJsonIssue\)/);
});

remediationTest('stt pending user and interviewer fragments flush before lifecycle transitions', () => {
    const tracker = readRemediationRepoFile('electron/SessionTracker.ts');
    const manager = readRemediationRepoFile('electron/IntelligenceManager.ts');
    const main = readRemediationRepoFile('electron/main.ts');

    remediationAssert.match(tracker, /pendingInterimBySpeaker = new Map<string, TranscriptSegment>/);
    remediationAssert.match(tracker, /flushInterimTranscript\(speaker\?: 'user' \| 'interviewer'\): number/);
    remediationAssert.match(manager, /flushPendingTranscriptFragments\(speaker\?: 'user' \| 'interviewer'\): number/);
    remediationAssert.match(main, /STT_FRAGMENT_PRESERVED.*scenario=reconfigure/);
    remediationAssert.match(main, /flushPendingTranscriptFragments\('user'\)/);
});

remediationTest('calendar dismissal persists beyond immediate recomputation', () => {
    const calendar = readRemediationRepoFile('electron/calendar/CalendarIntelligence.ts');

    remediationAssert.match(calendar, /DISMISS_RETENTION_MS = 14 \* 24 \* 60 \* 60 \* 1000/);
    remediationAssert.doesNotMatch(calendar, /DISMISS_COOLDOWN_MS = 0/);
    remediationAssert.match(calendar, /\[CALENDAR_DISMISSAL\]/);
});

remediationTest('screen ocr cache is per-request and no longer returns global no-change sentinel', () => {
    const helper = readRemediationRepoFile('electron/LLMHelper.ts');
    const vision = readRemediationRepoFile('electron/llm/VisionPipeline.ts');

    remediationAssert.doesNotMatch(helper, /lastOCRCache/);
    remediationAssert.doesNotMatch(helper, /lastScreenHash/);
    remediationAssert.doesNotMatch(vision, /lastOCRCache/);
    remediationAssert.doesNotMatch(vision, /lastScreenHash/);
    remediationAssert.match(helper, /cache=disabled isolation=per_request/);
});

remediationTest('screen scan prompt contracts are owned by ActionContextBuilder, not brain duplicates', () => {
    const contextBuilder = readRemediationRepoFile('electron/ActionContextBuilder.ts');
    const engine = readRemediationRepoFile('electron/IntelligenceEngine.ts');

    remediationAssert.match(contextBuilder, /case 'screen_scan':/);
    remediationAssert.match(contextBuilder, /createInstruction\('output_contract', 'OUTPUT CONTRACT'/);
    remediationAssert.match(engine, /return !CONTROLLED_PROMPT_SECTION_TITLES\.has\(title\)/);
    remediationAssert.match(engine, /\[PROMPT_OWNERSHIP\]/);
});
