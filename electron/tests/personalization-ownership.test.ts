import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import type { ResponseOwnership } from '../../src/lib/overlay/actionContextTypes';
import { applyPersonalizationMetadataToOwnership } from '../../src/lib/overlay/responseRoutingMetadata';

test('response ownership captures resolved personalization snapshot from debug metadata', () => {
    const ownership: ResponseOwnership = {
        responseId: 'response-1',
        questionTurnId: 'turn-1',
        transcriptVersion: 1,
        contextTarget: 'latest_turn',
        createdAt: 123,
    };

    const result = applyPersonalizationMetadataToOwnership(ownership, {
        personalization: {
            personalizationVersion: 1,
            resolvedCodingLanguage: 'TypeScript',
            providerPreference: 'groq',
            responseStyle: 'concise',
            interviewFocus: 'coding',
        },
    });

    assert.equal(result?.resolvedCodingLanguage, 'TypeScript');
    assert.equal(result?.providerPreference, 'groq');
    assert.equal(result?.responseStyle, 'concise');
    assert.equal(result?.interviewFocus, 'coding');
    assert.equal(result?.personalizationVersion, 1);
});
