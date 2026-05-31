import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { resolveNextActiveResponseSelection } from '../../src/lib/overlay/responseHistorySelection.ts';
import {
    capResponseHistoryMessages,
    sanitizeCappedResponseHistory,
} from '../../src/lib/overlay/responseHistoryState.ts';

const root = process.cwd();

type DiagramFixtureEdge = { source: string; target: string };
type DiagramDiffNodeFixture = string;
type DiagramDiffEdgeFixture = string;

function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('Pro V2 keeps a bounded response history instead of replacing the latest answer', () => {
    const bridge = read('src/components/pro-v2/useCluelyOverlayBridge.ts');

    assert.match(bridge, /const MAX_RESPONSE_HISTORY = 30/);
    assert.match(bridge, /function capOverlayMessages/);
    assert.match(bridge, /capResponseHistoryMessages\(nextMessages, MAX_RESPONSE_HISTORY\)/);
    assert.match(bridge, /const \[activeResponseId, setActiveResponseId\]/);
    assert.match(bridge, /const \[selectionMode, setSelectionMode\]/);
    assert.match(bridge, /const responseHistory = useMemo/);
    assert.match(bridge, /messages\.filter\(\(message\) => message\.role === 'system'\)/);
    assert.match(bridge, /const activeResponse = activeResponseId/);
    assert.match(bridge, /capResponseHistoryMessages/);
});

test('Pro V2 action routing reuses selected response history state', () => {
    const bridge = read('src/components/pro-v2/useCluelyOverlayBridge.ts');
    const panel = read('src/components/pro-v2/ProInsightsPanel.tsx');
    const shell = read('src/components/pro-v2/TeamSyncCluelyOverlay.tsx');

    assert.match(bridge, /resolveActionContext\(\{/);
    assert.match(bridge, /activeResponse: activeResponseRef\.current/);
    assert.match(bridge, /contextPreviewByActionId/);
    assert.match(bridge, /ownership/);
    assert.match(bridge, /parentResponseId: resolvedContext\.parentResponseId/);
    assert.doesNotMatch(bridge, /selectedResponseIndex/);
    assert.doesNotMatch(bridge, /selectedResponseRef/);
    assert.match(panel, /Using: \{contextPreviewByActionId\[action\.id\]/);
    assert.match(shell, /contextPreviewByActionId=\{bridge\.contextPreviewByActionId\}/);
});

test('Pro V2 auto-selects new responses and exposes previous/next navigation state', () => {
    const bridge = read('src/components/pro-v2/useCluelyOverlayBridge.ts');

    assert.match(bridge, /previousLatestResponseId: latestResponseIdRef\.current/);
    assert.match(bridge, /resolveNextActiveResponseSelection/);
    assert.match(bridge, /setResponseSelection\(latestResponse\?\.id \?\? null, 'latest'\)/);
    assert.match(bridge, /goToPreviousResponse/);
    assert.match(bridge, /goToNextResponse/);
    assert.match(bridge, /jumpToLatestResponse/);
    assert.match(bridge, /canGoPreviousResponse/);
    assert.match(bridge, /canGoNextResponse/);
    assert.match(bridge, /canJumpLatestResponse/);
    assert.match(bridge, /responseHistoryTotal/);
});

test('Pro V2 pinned historical response selection is not stolen by new incoming responses', () => {
    const nextSelection = resolveNextActiveResponseSelection({
        currentActiveResponseId: 'response-old',
        selectionMode: 'pinned',
        previousLatestResponseId: 'response-current',
        nextLatestResponseId: 'response-new',
        responseIds: ['response-old', 'response-current', 'response-new'],
    });

    assert.equal(nextSelection.activeResponseId, 'response-old');
    assert.equal(nextSelection.selectionMode, 'pinned');
    assert.equal(nextSelection.latestResponseId, 'response-new');
});

test('Pro V2 latest mode follows new responses until a response is pinned', () => {
    const nextSelection = resolveNextActiveResponseSelection({
        currentActiveResponseId: 'response-current',
        selectionMode: 'latest',
        previousLatestResponseId: 'response-current',
        nextLatestResponseId: 'response-new',
        responseIds: ['response-current', 'response-new'],
    });

    assert.equal(nextSelection.activeResponseId, 'response-new');
    assert.equal(nextSelection.selectionMode, 'latest');
});

test('Pro V2 history cap preserves valid chain roots after trimming dropped parents', () => {
    const capped = sanitizeCappedResponseHistory([
        {
            id: 'child-kept',
            role: 'system',
            rootResponseId: 'root-trimmed',
            ownership: {
                responseId: 'child-kept',
                questionTurnId: 'turn-1',
                transcriptVersion: 2,
                contextTarget: 'active_context' as const,
                parentResponseId: 'root-trimmed',
                createdAt: 2000,
            },
        },
        {
            id: 'grandchild-kept',
            role: 'system',
            rootResponseId: 'root-trimmed',
            ownership: {
                responseId: 'grandchild-kept',
                questionTurnId: 'turn-1',
                transcriptVersion: 3,
                contextTarget: 'active_context' as const,
                parentResponseId: 'child-kept',
                createdAt: 3000,
            },
        },
    ]);

    assert.equal(capped[0].ownership?.parentResponseId, undefined);
    assert.equal(capped[0].rootResponseId, 'child-kept');
    assert.equal(capped[1].ownership?.parentResponseId, 'child-kept');
    assert.equal(capped[1].rootResponseId, 'child-kept');
});

test('Pro V2 30-response cap trims history without stale parent or root references', () => {
    const messages = Array.from({ length: 32 }, (_, index) => {
        const responseNumber = index + 1;
        const id = `response-${responseNumber}`;
        const parentResponseId = responseNumber > 1 ? `response-${responseNumber - 1}` : undefined;

        return {
            id,
            role: 'system',
            rootResponseId: 'response-1',
            ownership: {
                responseId: id,
                questionTurnId: 'turn-chain',
                transcriptVersion: responseNumber,
                contextTarget: 'active_context' as const,
                parentResponseId,
                createdAt: responseNumber,
            },
        };
    });

    const capped = capResponseHistoryMessages(messages, 30);
    const keptIds = new Set(capped.map((message) => message.id));

    assert.equal(capped.length, 30);
    assert.equal(capped[0].id, 'response-3');
    assert.equal(capped[0].ownership?.parentResponseId, undefined);
    assert.equal(capped[0].rootResponseId, 'response-3');
    capped.forEach((message) => {
        assert.equal(keptIds.has(message.rootResponseId ?? ''), true);
        const parentResponseId = message.ownership?.parentResponseId;
        assert.equal(!parentResponseId || keptIds.has(parentResponseId), true);
    });
});

test('Pro V2 history cap re-roots retained diagram artifacts with their responses', () => {
    const messages = Array.from({ length: 45 }, (_, index) => {
        const responseNumber = index + 1;
        const id = `response-${responseNumber}`;
        const parentResponseId = responseNumber > 1 ? `response-${responseNumber - 1}` : undefined;
        const payload = {
            diagram: {
                type: 'architecture',
                nodes: [{ id: `node-${responseNumber}`, label: `Node ${responseNumber}` }],
                edges: [] as DiagramFixtureEdge[],
            },
            diff: {
                addedNodes: [`node-${responseNumber}`],
                removedNodes: [] as DiagramDiffNodeFixture[],
                modifiedNodes: [] as DiagramDiffNodeFixture[],
                addedEdges: [] as DiagramDiffEdgeFixture[],
                removedEdges: [] as DiagramDiffEdgeFixture[],
            },
        };

        return {
            id,
            role: 'system',
            rootResponseId: 'response-1',
            ownership: {
                responseId: id,
                questionTurnId: 'turn-chain',
                transcriptVersion: responseNumber,
                contextTarget: 'active_context' as const,
                parentResponseId,
                createdAt: responseNumber,
            },
            artifacts: [
                {
                    id: `${id}:architecture`,
                    responseId: id,
                    parentResponseId,
                    rootResponseId: 'response-1',
                    kind: 'architecture' as const,
                    source: 'architecture_json' as const,
                    createdAt: responseNumber,
                    status: 'parsed' as const,
                    payload,
                },
            ],
        };
    });

    const originalPayloadByResponseId = new Map(
        messages.map((message) => [message.id, message.artifacts[0].payload]),
    );
    const capped = capResponseHistoryMessages(messages, 30);
    const keptIds = new Set(capped.map((message) => message.id));

    assert.equal(capped.length, 30);
    assert.equal(capped[0].id, 'response-16');
    assert.equal(capped[0].ownership?.parentResponseId, undefined);
    assert.equal(capped[0].rootResponseId, 'response-16');

    capped.forEach((message, index) => {
        const artifact = message.artifacts?.[0];
        const expectedParentId = index === 0 ? undefined : capped[index - 1].id;

        assert.equal(message.rootResponseId, 'response-16');
        assert.equal(message.ownership?.parentResponseId, expectedParentId);
        assert.equal(artifact?.responseId, message.id);
        assert.equal(artifact?.parentResponseId, message.ownership?.parentResponseId);
        assert.equal(artifact?.rootResponseId, message.rootResponseId);
        assert.equal(artifact?.payload, originalPayloadByResponseId.get(message.id));
        assert.equal(keptIds.has(artifact?.rootResponseId ?? ''), true);
        assert.equal(!artifact?.parentResponseId || keptIds.has(artifact.parentResponseId), true);
    });
});

test('Pro V2 renderer follows the selected history entry, including system design diagrams', () => {
    const shell = read('src/components/pro-v2/TeamSyncCluelyOverlay.tsx');
    const surface = read('src/components/pro-v2/ProResponseSurface.tsx');
    const css = read('src/components/pro-v2/pro-v2.css');
    const layout = read('src/components/pro-v2/v2Layout.ts');

    assert.match(shell, /activeResponse=\{bridge\.activeResponse\}/);
    assert.match(shell, /activeResponseIndex=\{bridge\.activeResponseIndex\}/);
    assert.match(surface, /activeResponse: V2Message \| null/);
    assert.match(surface, /const renderedResponse = activeResponse/);
    assert.match(surface, /const isSystemDesignResponse = useMemo/);
    assert.match(surface, /v2-response-scroll--system-design/);
    assert.match(surface, /text=\{renderedResponse\.text\}/);
    assert.match(surface, /key=\{`response-\$\{renderedResponse\.id\}`\}/);
    assert.match(surface, /<ArchitectureRenderer/);
    assert.match(css, /\.v2-response-scroll--system-design/);
    assert.match(css, /max-height: min\(76vh, 700px\)/);
    assert.match(css, /padding: 10px 26px 24px 38px/);
    assert.match(layout, /V2_RESPONSE_MAX_WIDTH = 880/);
    assert.match(layout, /looksLikeWideSystemDesignResponse/);
    assert.match(layout, /V2_OVERLAY_WINDOW_MAX_HEIGHT = 860/);
    assert.doesNotMatch(surface, /latestResponse: V2Message \| null/);
});

test('Pro V2 navigation controls render previous/next buttons and current count', () => {
    const surface = read('src/components/pro-v2/ProResponseSurface.tsx');
    const css = read('src/components/pro-v2/pro-v2.css');

    assert.match(surface, /aria-label="Previous response"/);
    assert.match(surface, /aria-label="Next response"/);
    assert.match(surface, /aria-label="Jump to latest response"/);
    assert.match(surface, /Response \{activeResponseIndex \+ 1\} of \{responseHistoryTotal\}/);
    assert.match(css, /\.v2-response-switcher/);
    assert.match(css, /\.v2-response-switcher-btn/);
    assert.match(css, /\.v2-response-switcher-jump/);
    assert.match(css, /\.v2-response-switcher-count/);
});

test('Pro V2 metadata strip reflects selected response ownership without chain visualization UI', () => {
    const surface = read('src/components/pro-v2/ProResponseSurface.tsx');
    const css = read('src/components/pro-v2/pro-v2.css');

    assert.match(surface, /const responseMetaItems = useMemo/);
    assert.match(surface, /buildResponseMetaItems\(renderedResponse\)/);
    assert.match(surface, /aria-label="Response metadata"/);
    assert.match(surface, /ownership\?\.mode/);
    assert.match(surface, /ownership\?\.sourceProvider/);
    assert.match(surface, /ownership\?\.sourceModel/);
    assert.match(surface, /ownership\?\.actionId/);
    assert.match(surface, /ownership\?\.createdAt/);
    assert.match(surface, /ownership\?\.questionTurnId/);
    assert.match(surface, /ownership\?\.transcriptVersion/);
    assert.match(surface, /Question Turn/);
    assert.match(css, /\.v2-response-meta-strip/);
    assert.match(css, /\.v2-response-meta-item/);
    assert.match(css, /\.v2-response-meta-label/);
    assert.match(css, /\.v2-response-meta-value/);
    assert.doesNotMatch(surface, /Diagram 1/);
});

test('Pro V2 derives rootResponseId and keeps response artifacts data-ready without diagram history UI', () => {
    const bridge = read('src/components/pro-v2/useCluelyOverlayBridge.ts');
    const streams = read('src/components/pro-v2/useOverlayIpcStreams.ts');
    const artifacts = read('src/lib/overlay/responseArtifacts.ts');
    const diagramArtifacts = read('src/components/pro-v2/architecture/diagramArtifacts.ts');

    assert.match(bridge, /rootResponseId\?: string/);
    assert.match(bridge, /function deriveNewResponseRootId/);
    assert.match(bridge, /function buildResponseRootIdMap/);
    assert.match(bridge, /activeRootResponseId/);
    assert.match(bridge, /activeResponseChain/);
    assert.match(streams, /buildArchitectureResponseArtifacts/);
    assert.match(bridge, /buildArchitectureResponseArtifacts/);
    assert.match(artifacts, /function detectResponseArtifacts/);
    assert.match(artifacts, /parentResponseId\?: string/);
    assert.match(artifacts, /kind: 'architecture'/);
    assert.match(artifacts, /kind: 'mermaid'/);
    assert.match(diagramArtifacts, /parseArchitectureResponse/);
    assert.match(diagramArtifacts, /parentResponseId/);
    assert.match(diagramArtifacts, /rootResponseId/);
    assert.match(diagramArtifacts, /diffArchitectureDiagrams/);
    assert.doesNotMatch(bridge, /Diagram 1/);
});

test('Pro V2 model selector has enough width for long dynamic model names', () => {
    const helper = read('electron/ModelSelectorWindowHelper.ts');
    const selector = read('src/components/ModelSelectorWindow.tsx');
    const controlStrip = read('src/components/pro-v2/ProOverlayControlStrip.tsx');
    const css = read('src/components/pro-v2/pro-v2.css');
    const modelUtils = read('src/utils/modelUtils.ts');

    assert.match(helper, /MODEL_SELECTOR_WINDOW_WIDTH = 380/);
    assert.match(helper, /MODEL_SELECTOR_WINDOW_HEIGHT = 340/);
    assert.match(selector, /w-\[360px\]/);
    assert.match(selector, /\[overflow-wrap:anywhere\]/);
    assert.match(selector, /MODEL_PROVIDER_SHORT_LABELS/);
    assert.match(selector, /getModelProviderId\(model\.id, model\.provider, model\.type\)/);
    assert.match(controlStrip, /const modelDisplayName = getOverlayModelDisplayName\(currentModel\)/);
    assert.match(controlStrip, /const modelProvider = getModelProviderId\(currentModel\)/);
    assert.match(controlStrip, /data-provider=\{modelProvider\}/);
    assert.match(controlStrip, /title=\{`\$\{modelProviderLabel\} · \$\{modelDisplayName\}`\}/);
    assert.match(css, /max-width: none/);
    assert.match(css, /\.v2-overlay-model-provider\[data-provider='openai'\]/);
    assert.match(css, /\.v2-overlay-model-provider-dot/);
    assert.match(modelUtils, /export const MODEL_PROVIDER_LABELS/);
    assert.match(modelUtils, /export function getModelProviderId/);
});

test('Pro V2 architecture diagrams expose working pan, zoom, and inner controls', () => {
    const canvas = read('src/components/pro-v2/architecture/ArchitectureCanvas.tsx');
    const css = read('src/components/pro-v2/pro-v2.css');
    const architectureCss = css.slice(
        css.indexOf('/* ── V2 Architecture Renderer'),
        css.indexOf('.v2-architecture-parse-error'),
    );

    assert.match(canvas, /function ArchitectureSkeletonContent/);
    assert.match(canvas, /getViewport/);
    assert.match(canvas, /setViewport/);
    assert.match(canvas, /viewportByChainKey/);
    assert.match(canvas, /diagramChainKey/);
    assert.match(canvas, /x: viewport\.x \+ 18/);
    assert.match(canvas, /y: viewport\.y \+ 16/);
    assert.match(canvas, /!isLayoutReady \? \(/);
    assert.doesNotMatch(canvas, /if \(!isLayoutReady\) return <ArchitectureSkeleton/);
    assert.match(canvas, /Controls,/);
    assert.match(canvas, /<Controls/);
    assert.match(canvas, /position="top-right"/);
    assert.match(canvas, /panOnDrag=\{\[0, 1, 2\]\}/);
    assert.match(canvas, /zoomOnScroll/);
    assert.match(canvas, /onlyRenderVisibleElements/);
    assert.doesNotMatch(canvas, /duration: 420/);
    assert.match(canvas, /onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/);
    assert.doesNotMatch(canvas, /onPointerDownCapture=\{\(event\) => event\.stopPropagation\(\)\}/);
    assert.doesNotMatch(canvas, /onWheelCapture=\{\(event\) => event\.stopPropagation\(\)\}/);
    assert.match(css, /\.v2-architecture-controls/);
    assert.match(css, /\.v2-architecture-shell \.react-flow__controls/);
    assert.match(css, /\.v2-architecture-node-failure/);
    assert.doesNotMatch(architectureCss, /drop-shadow/);
    assert.doesNotMatch(architectureCss, /will-change: transform/);
    assert.doesNotMatch(architectureCss, /backdrop-filter/);
});

test('Pro V2 overlay utility controls use dedicated premium icon states', () => {
    const controlStrip = read('src/components/pro-v2/ProOverlayControlStrip.tsx');
    const css = read('src/components/pro-v2/pro-v2.css');

    assert.match(controlStrip, /v2-overlay-icon-btn--settings/);
    assert.match(controlStrip, /aria-pressed=\{isSettingsOpen\}/);
    assert.match(controlStrip, /aria-pressed=\{isMousePassthrough\}/);
    assert.match(controlStrip, /aria-pressed=\{customNotesEnabled\}/);
    assert.match(css, /\.v2-panel-btn\.v2-overlay-icon-btn/);
    assert.match(css, /\.v2-panel-btn\.v2-overlay-icon-btn--active::after/);
    assert.match(css, /\.v2-panel-btn\.v2-overlay-icon-btn--passthrough/);
    assert.match(css, /\.v2-panel-btn\.v2-overlay-icon-btn--context/);
});

test('Pro V2 streaming responses do not trigger resize bursts for every token', () => {
    const shell = read('src/components/pro-v2/TeamSyncCluelyOverlay.tsx');
    const contentRevisionBlock = shell.slice(
        shell.indexOf('contentRevision: ['),
        shell.indexOf('].join', shell.indexOf('contentRevision: [')),
    );

    assert.match(shell, /const activeResponseContentRevision = bridge\.activeResponse\?\.isStreaming/);
    assert.match(shell, /\? 'streaming'/);
    assert.match(contentRevisionBlock, /activeResponseContentRevision/);
    assert.doesNotMatch(contentRevisionBlock, /activeResponse\?\.text\.length/);
});

test('Pro V2 rolling transcript supports smooth normal and wide pill shapes', () => {
    const rollingTranscript = read('src/components/ui/RollingTranscript.tsx');

    assert.match(rollingTranscript, /const proV2Shape = useMemo/);
    assert.match(rollingTranscript, /tone: shouldUseWide \? 'wide' : 'normal'/);
    assert.match(rollingTranscript, /data-transcript-shape=\{isProV2 \? proV2Shape\.tone : undefined\}/);
    assert.match(rollingTranscript, /maxWidth: proV2Shape\.maxWidth/);
    assert.match(rollingTranscript, /type: 'spring' as const/);
    assert.match(rollingTranscript, /useReducedMotion/);
    assert.match(rollingTranscript, /paddingTop: proV2Shape\.padding\.top/);
    assert.match(rollingTranscript, /key=\{`transcript-\$\{quoted\}`\}/);
    assert.match(rollingTranscript, /filter: 'blur\(3px\)'/);
    assert.doesNotMatch(rollingTranscript, /scaleX: proV2Shape\.tone === 'wide'/);
});

test('Manual typed questions are treated as authoritative standalone inputs', () => {
    const bridge = read('src/components/pro-v2/useCluelyOverlayBridge.ts');
    const v1 = read('src/components/TeamSyncInterface.tsx');
    const contextBuilder = read('electron/ActionContextBuilder.ts');
    const prompts = read('electron/llm/prompts.ts');

    assert.match(bridge, /function isStandaloneManualInput/);
    assert.match(bridge, /function buildManualStreamContext/);
    assert.match(bridge, /standaloneManualInput \? '' : finalizedTranscript\.slice\(-transcriptWindow\)/);
    assert.match(bridge, /RECENT OVERLAY TRANSCRIPT/);
    assert.doesNotMatch(bridge, /RESPONSE RULES:/);

    assert.match(v1, /const standaloneManualInput = currentAttachments\.length === 0/);
    assert.match(v1, /RECENT OVERLAY TRANSCRIPT/);
    assert.doesNotMatch(v1, /RESPONSE RULES:/);

    assert.match(contextBuilder, /The typed USER QUESTION is authoritative over transcript/);

    assert.match(contextBuilder, /profile === 'fresh_general' && wordCount <= 14/);
    assert.match(contextBuilder, /profile === 'coding' \|\| profile === 'system_design'/);
    assert.match(contextBuilder, /explicitContextPatterns/);
    assert.match(contextBuilder, /\|build\|tell\)/);

    assert.match(prompts, /Treat USER QUESTION as the primary task/);
    assert.match(prompts, /Avoid textbook definition openers/);
    assert.match(prompts, /Do not continue an older transcript topic/);
});

test('Streaming updates mutate the existing request entry rather than creating duplicate history rows', () => {
    const streams = read('src/components/pro-v2/useOverlayIpcStreams.ts');

    assert.match(streams, /const idx = prev\.findIndex\(\(msg\) => msg\.requestId === requestId\)/);
    assert.match(streams, /u\[idx\] = \{ \.\.\.u\[idx\], text: nextText/);
    assert.match(streams, /finishStreamingMessage\(requestId/);
});

test('V1 still renders the full chat message list', () => {
    const v1 = read('src/components/TeamSyncInterface.tsx');

    assert.match(v1, /\{messages\.map\(\(msg\) => \(/);
    assert.match(v1, /<div ref=\{messagesEndRef\}/);
});
