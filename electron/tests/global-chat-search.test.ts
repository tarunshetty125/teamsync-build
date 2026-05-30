import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('global launcher chat falls back when global RAG has no relevant meeting context', () => {
    const ipc = read('electron/ipcHandlers.ts');
    const globalHandler = ipc.slice(
        ipc.indexOf('safeHandle("rag:query-global"'),
        ipc.indexOf('// Cancel active RAG query'),
    );

    assert.match(globalHandler, /requestId: providedRequestId/);
    assert.match(globalHandler, /NO_RELEVANT_CONTEXT/);
    assert.match(globalHandler, /NO_MEETING_EMBEDDINGS/);
    assert.match(globalHandler, /return \{ fallback: true \}/);
    assert.match(globalHandler, /rag:stream-chunk", \{ global: true, chunk: payload\.token, requestId \}/);
});

test('global chat fallback passes a request id so streaming tokens are not filtered out', () => {
    const overlay = read('src/components/GlobalChatOverlay.tsx');

    assert.match(overlay, /const requestId = `global-chat-/);
    assert.match(overlay, /const ragRequestId = `\$\{requestId\}-rag`/);
    assert.match(overlay, /const fallbackRequestId = `\$\{requestId\}-fallback`/);
    assert.match(overlay, /ragQueryGlobal\(question, ragRequestId\)/);
    assert.match(overlay, /requestId: fallbackRequestId/);
    assert.match(overlay, /payload\?\.requestId !== fallbackRequestId/);
});
