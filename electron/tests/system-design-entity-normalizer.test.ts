import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { normalizeQuestion } from '../intelligence/utils.ts';
import {
  detectQuestionType,
  normalizeTranscript,
} from '../../src/lib/overlay/overlayIntent.ts';
import { normalizeSystemDesignEntityTypos } from '../../src/lib/overlay/systemDesignEntityNormalizer.ts';

const root = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('system design entity typo normalizer fixes common product misspellings', () => {
  assert.equal(normalizeSystemDesignEntityTypos('design flikart'), 'design Flipkart');
  assert.equal(normalizeSystemDesignEntityTypos('design flip krat', { casing: 'lower' }), 'design flipkart');
  assert.equal(normalizeSystemDesignEntityTypos('design watsapp'), 'design WhatsApp');
});

test('system design detection catches typo-normalized product prompts', () => {
  assert.equal(normalizeTranscript('design flikart'), 'design flipkart');
  assert.equal(normalizeQuestion('design flikart'), 'design flipkart');
  assert.equal(detectQuestionType('design flikart', 'general', 'general').nextType, 'system_design');
});

test('manual system design prompts normalize entity typos before prompt serialization', () => {
  const builder = read('electron/ActionContextBuilder.ts');

  assert.match(builder, /function normalizeActionQuestion/);
  assert.match(builder, /shouldNormalizeSystemDesignQuestion\(question, mode, intent\)/);
  assert.match(builder, /normalizeSystemDesignEntityTypos\(question\)/);
  assert.match(builder, /const rawQuestion = \(\(\) =>/);
  assert.match(builder, /const question = normalizeActionQuestion\(rawQuestion, mode, intent\)/);
});
