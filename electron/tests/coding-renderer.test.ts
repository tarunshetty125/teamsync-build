import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function read(pathFromRoot: string): string {
    return readFileSync(join(process.cwd(), pathFromRoot), 'utf8');
}

test('Pro V2 coding renderer uses contract sections before fence fallback', () => {
    const surface = read('src/components/pro-v2/ProResponseSurface.tsx');

    assert.match(surface, /function parseCodingContractSections/);
    assert.match(surface, /function renderStructuredCodingContract/);
    assert.match(surface, /actionContract=\{renderedResponse\.actionContract\}/);
    assert.match(surface, /if \(structuredCodingContract\) return structuredCodingContract/);
});

test('Pro V2 coding renderer has dedicated contract section styling', () => {
    const css = read('src/components/pro-v2/pro-v2.css');

    assert.match(css, /\.v2-coding-contract\b/);
    assert.match(css, /\.v2-coding-contract-section\b/);
    assert.match(css, /\.v2-coding-contract-section-title\b/);
});

