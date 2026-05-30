import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('Pro V2 keeps a bounded response history instead of replacing the latest answer', () => {
    const bridge = read('src/components/pro-v2/useCluelyOverlayBridge.ts');

    assert.match(bridge, /const MAX_RESPONSE_HISTORY = 30/);
    assert.match(bridge, /function capOverlayMessages/);
    assert.match(bridge, /systemIndexes\.length - MAX_RESPONSE_HISTORY/);
    assert.match(bridge, /const \[activeResponseIndex, setActiveResponseIndex\]/);
    assert.match(bridge, /const responseHistory = useMemo/);
    assert.match(bridge, /messages\.filter\(\(message\) => message\.role === 'system'\)/);
    assert.match(bridge, /const activeResponse = activeResponseIndex >= 0/);
});

test('Pro V2 auto-selects new responses and exposes previous/next navigation state', () => {
    const bridge = read('src/components/pro-v2/useCluelyOverlayBridge.ts');

    assert.match(bridge, /latestResponseIdRef\.current !== latestId/);
    assert.match(bridge, /setActiveResponseIndex\(responseHistory\.length - 1\)/);
    assert.match(bridge, /goToPreviousResponse/);
    assert.match(bridge, /goToNextResponse/);
    assert.match(bridge, /canGoPreviousResponse/);
    assert.match(bridge, /canGoNextResponse/);
    assert.match(bridge, /responseHistoryTotal/);
});

test('Pro V2 renderer follows the selected history entry, including system design diagrams', () => {
    const shell = read('src/components/pro-v2/TeamSyncCluelyOverlay.tsx');
    const surface = read('src/components/pro-v2/ProResponseSurface.tsx');

    assert.match(shell, /activeResponse=\{bridge\.activeResponse\}/);
    assert.match(shell, /activeResponseIndex=\{bridge\.activeResponseIndex\}/);
    assert.match(surface, /activeResponse: V2Message \| null/);
    assert.match(surface, /const renderedResponse = activeResponse/);
    assert.match(surface, /text=\{renderedResponse\.text\}/);
    assert.match(surface, /key=\{`response-\$\{renderedResponse\.id\}`\}/);
    assert.match(surface, /<ArchitectureRenderer/);
    assert.doesNotMatch(surface, /latestResponse: V2Message \| null/);
});

test('Pro V2 navigation controls render previous/next buttons and current count', () => {
    const surface = read('src/components/pro-v2/ProResponseSurface.tsx');
    const css = read('src/components/pro-v2/pro-v2.css');

    assert.match(surface, /aria-label="Previous response"/);
    assert.match(surface, /aria-label="Next response"/);
    assert.match(surface, /\{activeResponseIndex \+ 1\} \/ \{responseHistoryTotal\}/);
    assert.match(css, /\.v2-response-switcher/);
    assert.match(css, /\.v2-response-switcher-btn/);
    assert.match(css, /\.v2-response-switcher-count/);
});

test('Pro V2 model selector has enough width for long dynamic model names', () => {
    const helper = read('electron/ModelSelectorWindowHelper.ts');
    const selector = read('src/components/ModelSelectorWindow.tsx');
    const controlStrip = read('src/components/pro-v2/ProOverlayControlStrip.tsx');
    const css = read('src/components/pro-v2/pro-v2.css');

    assert.match(helper, /MODEL_SELECTOR_WINDOW_WIDTH = 380/);
    assert.match(helper, /MODEL_SELECTOR_WINDOW_HEIGHT = 340/);
    assert.match(selector, /w-\[360px\]/);
    assert.match(selector, /\[overflow-wrap:anywhere\]/);
    assert.match(controlStrip, /const modelDisplayName = getOverlayModelDisplayName\(currentModel\)/);
    assert.match(controlStrip, /title=\{modelDisplayName\}/);
    assert.match(css, /max-width: 240px/);
});

test('Pro V2 architecture diagrams expose working pan, zoom, and inner controls', () => {
    const canvas = read('src/components/pro-v2/architecture/ArchitectureCanvas.tsx');
    const css = read('src/components/pro-v2/pro-v2.css');

    assert.match(canvas, /function ArchitectureSkeletonContent/);
    assert.match(canvas, /!isLayoutReady \? \(/);
    assert.doesNotMatch(canvas, /if \(!isLayoutReady\) return <ArchitectureSkeleton/);
    assert.match(canvas, /Controls,/);
    assert.match(canvas, /<Controls/);
    assert.match(canvas, /position="top-right"/);
    assert.match(canvas, /panOnDrag=\{\[0, 1, 2\]\}/);
    assert.match(canvas, /zoomOnScroll/);
    assert.match(canvas, /onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/);
    assert.doesNotMatch(canvas, /onPointerDownCapture=\{\(event\) => event\.stopPropagation\(\)\}/);
    assert.doesNotMatch(canvas, /onWheelCapture=\{\(event\) => event\.stopPropagation\(\)\}/);
    assert.match(css, /\.v2-architecture-controls/);
    assert.match(css, /\.v2-architecture-shell \.react-flow__controls/);
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
