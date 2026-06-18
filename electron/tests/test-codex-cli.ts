/**
 * Codex CLI Integration Test
 * Tests: 1) CLI detection  2) Send prompt & get response  3) IPC wiring check
 * 
 * Usage: npx ts-node electron/tests/test-codex-cli.ts
 *    or: npx tsx electron/tests/test-codex-cli.ts
 */

import { CodexCliService, DEFAULT_CODEX_CLI_CONFIG } from '../services/CodexCliService';

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const INFO = '\x1b[36mℹ\x1b[0m';
let passed = 0;
let failed = 0;

function log(ok: boolean, label: string, detail?: string) {
  if (ok) { passed++; console.log(`  ${PASS} ${label}${detail ? ` — ${detail}` : ''}`); }
  else { failed++; console.log(`  ${FAIL} ${label}${detail ? ` — ${detail}` : ''}`); }
}

async function main() {
  console.log('\n\x1b[1m── Codex CLI Integration Tests ──\x1b[0m\n');

  // ─── Test 1: normalizeConfig ─────────────────────────────────────────
  console.log('\x1b[1m1. Config normalization\x1b[0m');
  const defaultConfig = CodexCliService.normalizeConfig({});
  log(defaultConfig.path === 'codex', 'Default path is "codex"', defaultConfig.path);
  log(defaultConfig.model === 'gpt-5.4', 'Default model', defaultConfig.model);
  log(defaultConfig.fastModel === 'gpt-5.3-codex', 'Default fast model', defaultConfig.fastModel);
  log(defaultConfig.timeoutMs === 60000, 'Default timeout', `${defaultConfig.timeoutMs}ms`);
  log(defaultConfig.enabled === false, 'Default disabled');
  log(defaultConfig.sandboxMode === 'read-only', 'Default sandbox', defaultConfig.sandboxMode);

  const customConfig = CodexCliService.normalizeConfig({
    enabled: true, path: '/usr/local/bin/codex', model: 'o3', timeoutMs: -1,
    sandboxMode: 'invalid' as any, serviceTier: 'fast',
  });
  log(customConfig.enabled === true, 'Custom enabled=true');
  log(customConfig.path === '/usr/local/bin/codex', 'Custom path preserved');
  log(customConfig.model === 'o3', 'Custom model preserved');
  log(customConfig.timeoutMs === DEFAULT_CODEX_CLI_CONFIG.timeoutMs, 'Invalid timeout falls back to default');
  log(customConfig.sandboxMode === 'read-only', 'Invalid sandbox falls back to default');
  log(customConfig.serviceTier === 'fast', 'Valid service tier preserved');

  // ─── Test 2: Auto-detect paths ───────────────────────────────────────
  console.log('\n\x1b[1m2. Auto-detection\x1b[0m');
  const candidates = CodexCliService.getCandidatePaths();
  log(candidates.length > 0, `${candidates.length} candidate paths generated`);
  console.log(`  ${INFO} Candidates: ${candidates.slice(0, 3).join(', ')}${candidates.length > 3 ? '...' : ''}`);

  const detected = CodexCliService.autoDetectPath();
  if (detected) {
    log(true, `Auto-detected codex at: ${detected}`);
  } else {
    console.log(`  ${INFO} No codex binary found on filesystem (install codex to test further)`);
  }

  // ─── Test 3: Validate executable ─────────────────────────────────────
  console.log('\n\x1b[1m3. Executable validation\x1b[0m');
  const validation = await CodexCliService.validateExecutable('codex', 5000);
  if (validation.success) {
    log(true, 'codex --version succeeded', `resolved: ${validation.resolvedPath}`);
  } else {
    log(false, 'codex --version failed', validation.error);
    console.log(`  ${INFO} This is expected if codex is not installed. Install with: npm i -g @openai/codex`);
  }

  // ─── Test 4: JSONL parsing ───────────────────────────────────────────
  console.log('\n\x1b[1m4. JSONL text extraction\x1b[0m');
  
  // Simple text delta
  const delta1 = CodexCliService.extractText('{"type":"agent_message","text":"Hello world"}');
  log(delta1 === 'Hello world', 'agent_message text', delta1);

  // Nested delta
  const delta2 = CodexCliService.extractText('{"delta":"chunk of text"}');
  log(delta2 === 'chunk of text', 'delta field', delta2);

  // Error event should return empty
  const err1 = CodexCliService.extractText('{"type":"error","error":{"message":"rate limited"}}');
  log(err1 === '', 'error event returns empty');

  // Multi-line JSONL
  const multiline = CodexCliService.extractText(
    '{"delta":"Hello "}\n{"delta":"world"}\n{"type":"turn.completed"}'
  );
  log(multiline === 'Hello world', 'Multi-line JSONL concat', multiline);

  // Plain text fallback
  const plain = CodexCliService.extractText('Just plain text response');
  log(plain === 'Just plain text response', 'Plain text fallback', plain);

  // ─── Test 5: Error extraction ────────────────────────────────────────
  console.log('\n\x1b[1m5. Error extraction\x1b[0m');
  const codexErr = CodexCliService.extractCodexError(
    '{"type":"error","error":{"message":"model not supported"}}'
  );
  log(codexErr === 'model not supported', 'Extracts error message', codexErr);

  const noErr = CodexCliService.extractCodexError('{"delta":"hello"}');
  log(noErr === '', 'No error in normal response');

  // ─── Test 6: Live prompt (only if codex is available) ────────────────
  console.log('\n\x1b[1m6. Live prompt test\x1b[0m');
  if (validation.success && validation.resolvedPath) {
    try {
      console.log(`  ${INFO} Sending prompt: "Say hello in one word" ...`);
      const response = await CodexCliService.run(validation.resolvedPath, {
        prompt: 'Say hello in exactly one word. No explanation.',
        model: 'gpt-5.4',
        timeoutMs: 30000,
        sandboxMode: 'read-only',
      });
      log(response.length > 0, 'Got response from Codex CLI', `"${response.slice(0, 100)}"`);
      log(typeof response === 'string', 'Response is string');
    } catch (e: any) {
      log(false, 'Live prompt failed', e.message);
    }

    // Streaming test
    try {
      console.log(`  ${INFO} Testing streaming: "Count 1 2 3" ...`);
      let chunks: string[] = [];
      const stream = CodexCliService.stream(validation.resolvedPath, {
        prompt: 'Count to 3. Just output: 1 2 3',
        model: 'gpt-5.4',
        timeoutMs: 30000,
        sandboxMode: 'read-only',
      });
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      const full = chunks.join('');
      log(chunks.length > 0, `Stream yielded ${chunks.length} chunk(s)`, `"${full.slice(0, 100)}"`);
    } catch (e: any) {
      log(false, 'Streaming failed', e.message);
    }
  } else {
    console.log(`  ${INFO} Skipped — codex not available`);
  }

  // ─── Test 7: IPC wiring check ────────────────────────────────────────
  console.log('\n\x1b[1m7. IPC wiring verification\x1b[0m');
  try {
    // Check that ipcHandlers registers the channels
    const fs = require('fs');
    const ipcSource = fs.readFileSync(require('path').join(__dirname, '..', 'ipcHandlers.ts'), 'utf-8');
    log(ipcSource.includes('"get-codex-cli-config"'), 'IPC: get-codex-cli-config registered');
    log(ipcSource.includes('"set-codex-cli-config"'), 'IPC: set-codex-cli-config registered');
    log(ipcSource.includes('"test-codex-cli"'), 'IPC: test-codex-cli registered');

    // Check preload exposes the bridge
    const preloadSource = fs.readFileSync(require('path').join(__dirname, '..', 'preload.ts'), 'utf-8');
    log(preloadSource.includes('getCodexCliConfig'), 'Preload: getCodexCliConfig exposed');
    log(preloadSource.includes('setCodexCliConfig'), 'Preload: setCodexCliConfig exposed');
    log(preloadSource.includes('testCodexCli'), 'Preload: testCodexCli exposed');

    // Check UI renders the component
    const uiSource = fs.readFileSync(require('path').join(__dirname, '..', '..', 'src', 'components', 'SettingsOverlay.tsx'), 'utf-8');
    log(uiSource.includes('CodexCliSettings'), 'UI: CodexCliSettings component exists');
    log(uiSource.includes("activeTab === 'codex-cli'"), 'UI: codex-cli tab rendered');
    log(uiSource.includes('getCodexCliConfig'), 'UI: calls getCodexCliConfig');
    log(uiSource.includes('testCodexCli'), 'UI: calls testCodexCli');

    // Check types
    const typesSource = fs.readFileSync(require('path').join(__dirname, '..', '..', 'src', 'types', 'electron.d.ts'), 'utf-8');
    log(typesSource.includes('getCodexCliConfig'), 'Types: getCodexCliConfig declared');
    log(typesSource.includes('setCodexCliConfig'), 'Types: setCodexCliConfig declared');
    log(typesSource.includes('testCodexCli'), 'Types: testCodexCli declared');
  } catch (e: any) {
    log(false, 'Wiring check failed', e.message);
  }

  // ─── Summary ─────────────────────────────────────────────────────────
  console.log(`\n\x1b[1m── Results: ${passed} passed, ${failed} failed ──\x1b[0m\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
