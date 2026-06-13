const test: typeof import('node:test').test = require('node:test').test;
const assert: typeof import('node:assert').strict = require('node:assert').strict;
const fs: typeof import('node:fs') = require('node:fs');
const path: typeof import('node:path') = require('node:path');

export {};

// ---------------------------------------------------------------------------
// Source reading helper
// ---------------------------------------------------------------------------
function readSource(relativePath: string): string {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const LLMHELPER_SOURCE = readSource('electron/LLMHelper.ts');

// Regex that was previously used to gate profile context injection
const OLD_PROFILE_QUERY_REGEX = /isProfileQuery.*=.*\/experience\|project\|salary/;

// Questions that did NOT match the old regex but ARE valid profile queries
const NON_REGEX_PROFILE_QUESTIONS = [
    'What technologies do you know?',
    'Describe your architecture approach.',
    'How do you handle deadlines?',
    'What is your biggest weakness?',
    'Why should we hire you?',
    'What are you passionate about?',
    'How do you stay current with tech trends?',
];

// Questions that DID match the old regex (regression check — these must still work)
const REGEX_MATCHING_QUESTIONS = [
    'Tell me about your experience with databases',
    'What projects have you worked on?',
    'Why are you interested in this role?',
    'Tell me about your background in distributed systems',
];

// ---------------------------------------------------------------------------
// 1. P1 Fix Proof: isProfileQuery regex removed from both paths
// ---------------------------------------------------------------------------

test('P1: isProfileQuery regex gate is removed from streaming path', () => {
    // The old code had: const isProfileQuery = /experience|project|salary|...|tell me about/i.test(message);
    // in the streaming path (streamChat). Verify it no longer exists.
    const streamingSection = extractStreamingKnowledgeSection(LLMHELPER_SOURCE);
    assert.ok(streamingSection, 'Should find streaming knowledge intercept section');
    assert.equal(
        OLD_PROFILE_QUERY_REGEX.test(streamingSection),
        false,
        'isProfileQuery regex must NOT exist in streaming path'
    );
    assert.ok(
        !streamingSection.includes('TOKEN-OPT: Skipping profile context'),
        'TOKEN-OPT skip log must NOT exist in streaming path'
    );
});

test('P1: isProfileQuery regex gate is removed from non-streaming path', () => {
    const nonStreamingSection = extractNonStreamingKnowledgeSection(LLMHELPER_SOURCE);
    assert.ok(nonStreamingSection, 'Should find non-streaming knowledge intercept section');
    assert.equal(
        OLD_PROFILE_QUERY_REGEX.test(nonStreamingSection),
        false,
        'isProfileQuery regex must NOT exist in non-streaming path'
    );
    assert.ok(
        !nonStreamingSection.includes('TOKEN-OPT: Skipping profile context'),
        'TOKEN-OPT skip log must NOT exist in non-streaming path'
    );
});

test('P1: context block injection is unconditional when profile evidence exists', () => {
    // Both paths must inject contextBlock whenever it has content — no regex filter
    const streamingSection = extractStreamingKnowledgeSection(LLMHELPER_SOURCE);
    const nonStreamingSection = extractNonStreamingKnowledgeSection(LLMHELPER_SOURCE);

    // Verify the new pattern: hasProfileEvidence check followed by unconditional contextBlock injection
    assert.ok(
        streamingSection.includes('hasProfileEvidence'),
        'Streaming path must use hasProfileEvidence guard'
    );
    assert.ok(
        nonStreamingSection.includes('hasProfileEvidence'),
        'Non-streaming path must use hasProfileEvidence guard'
    );

    // Verify context injection happens inside the hasProfileEvidence block
    assert.ok(
        streamingSection.includes('knowledgeResult.contextBlock'),
        'Streaming path must inject contextBlock'
    );
    assert.ok(
        nonStreamingSection.includes('knowledgeResult.contextBlock'),
        'Non-streaming path must inject contextBlock'
    );
});

// ---------------------------------------------------------------------------
// 2. P3 Fix Proof: Streaming and non-streaming parity
// ---------------------------------------------------------------------------

test('P3: streaming and non-streaming paths use identical evidence check logic', () => {
    const streamingSection = extractStreamingKnowledgeSection(LLMHELPER_SOURCE);
    const nonStreamingSection = extractNonStreamingKnowledgeSection(LLMHELPER_SOURCE);

    // Both must compute hasProfileEvidence identically
    const evidencePattern = `Boolean(knowledgeResult.contextBlock?.trim()) ||`;
    assert.ok(
        streamingSection.includes(evidencePattern),
        'Streaming must have contextBlock evidence check'
    );
    assert.ok(
        nonStreamingSection.includes(evidencePattern),
        'Non-streaming must have contextBlock evidence check'
    );

    const directResponsePattern = 'Boolean(knowledgeResult.directResponse)';
    assert.ok(
        streamingSection.includes(directResponsePattern),
        'Streaming must have directResponse evidence check'
    );
    assert.ok(
        nonStreamingSection.includes(directResponsePattern),
        'Non-streaming must have directResponse evidence check'
    );
});

test('P3: both paths use identical suppression message pattern', () => {
    const streamingSection = extractStreamingKnowledgeSection(LLMHELPER_SOURCE);
    const nonStreamingSection = extractNonStreamingKnowledgeSection(LLMHELPER_SOURCE);

    assert.ok(
        streamingSection.includes('Profile identity prompt suppressed'),
        'Streaming must log suppression'
    );
    assert.ok(
        nonStreamingSection.includes('Profile identity prompt suppressed'),
        'Non-streaming must log suppression'
    );
});

test('P3: both paths guard prompt injection inside evidence check', () => {
    const streamingSection = extractStreamingKnowledgeSection(LLMHELPER_SOURCE);
    const nonStreamingSection = extractNonStreamingKnowledgeSection(LLMHELPER_SOURCE);

    // Streaming path uses systemPromptOverride inside the evidence guard
    const streamEvidenceBlock = extractEvidenceBlock(streamingSection);
    assert.ok(
        streamEvidenceBlock.includes('systemPromptOverride = knowledgeResult.systemPromptInjection'),
        'Streaming: systemPromptOverride must be inside evidence guard'
    );

    // Non-streaming path uses skipSystemPrompt = false inside the evidence guard
    // (chatWithGemini doesn't have a systemPromptOverride variable — it uses fixed system prompts)
    const nonStreamEvidenceBlock = extractEvidenceBlock(nonStreamingSection);
    assert.ok(
        nonStreamEvidenceBlock.includes('skipSystemPrompt = false'),
        'Non-streaming: skipSystemPrompt must be set inside evidence guard'
    );

    // Both must have the suppression else-branch
    assert.ok(
        streamingSection.includes('Profile identity prompt suppressed'),
        'Streaming must have suppression branch'
    );
    assert.ok(
        nonStreamingSection.includes('Profile identity prompt suppressed'),
        'Non-streaming must have suppression branch'
    );
});

// ---------------------------------------------------------------------------
// 3. P7 Fix Proof: Identity prompt suppressed without evidence
// ---------------------------------------------------------------------------

test('P7: identity prompt is NOT injected when contextBlock is empty and no directResponse', () => {
    // Simulate: knowledgeResult = { systemPromptInjection: 'You are...', contextBlock: '', isIntroQuestion: false }
    // Expected: hasProfileEvidence = false → systemPromptOverride NOT set → no hallucination

    const streamingSection = extractStreamingKnowledgeSection(LLMHELPER_SOURCE);

    // The new code structure must be:
    // if (knowledgeResult.systemPromptInjection) {
    //   const hasProfileEvidence = ...
    //   if (hasProfileEvidence) { /* inject */ }
    //   else { /* suppress */ }
    // }
    //
    // NOT:
    // if (knowledgeResult.systemPromptInjection) { systemPromptOverride = ... }  // unconditional
    // if (knowledgeResult.contextBlock) { ... }                                   // separate

    // Verify systemPromptOverride is NOT set outside the evidence guard
    const linesBeforeEvidence = streamingSection.split('hasProfileEvidence')[0];
    assert.ok(
        !linesBeforeEvidence.includes('systemPromptOverride = knowledgeResult.systemPromptInjection'),
        'P7: systemPromptOverride must NOT be set before hasProfileEvidence check'
    );
});

test('P7: identity prompt IS injected when contextBlock has content', () => {
    // Verify the positive case: when contextBlock is non-empty, both prompt and context are injected
    const streamingSection = extractStreamingKnowledgeSection(LLMHELPER_SOURCE);
    const evidenceBlock = extractEvidenceBlock(streamingSection);

    assert.ok(
        evidenceBlock.includes('systemPromptOverride = knowledgeResult.systemPromptInjection'),
        'When evidence exists, systemPromptOverride must be set'
    );
    assert.ok(
        evidenceBlock.includes('knowledgeResult.contextBlock'),
        'When evidence exists, contextBlock must be injected'
    );
});

test('P7: evidence check includes directResponse for future-proofing', () => {
    const streamingSection = extractStreamingKnowledgeSection(LLMHELPER_SOURCE);

    // hasProfileEvidence must check BOTH contextBlock AND directResponse
    assert.ok(
        streamingSection.includes('Boolean(knowledgeResult.directResponse)'),
        'Evidence check must include directResponse'
    );
});

// ---------------------------------------------------------------------------
// 4. Regression: Intro short-circuit still works
// ---------------------------------------------------------------------------

test('Regression: intro question short-circuit preserved in streaming path', () => {
    const streamingSection = extractStreamingKnowledgeSection(LLMHELPER_SOURCE);
    assert.ok(
        streamingSection.includes('knowledgeResult.isIntroQuestion && knowledgeResult.introResponse'),
        'Intro short-circuit must still exist in streaming path'
    );
    // The intro return must happen BEFORE the evidence guard
    const introPos = streamingSection.indexOf('isIntroQuestion');
    const evidencePos = streamingSection.indexOf('hasProfileEvidence');
    assert.ok(
        introPos < evidencePos,
        'Intro short-circuit must execute before evidence guard'
    );
});

test('Regression: intro question short-circuit preserved in non-streaming path', () => {
    const nonStreamingSection = extractNonStreamingKnowledgeSection(LLMHELPER_SOURCE);
    assert.ok(
        nonStreamingSection.includes('knowledgeResult.isIntroQuestion && knowledgeResult.introResponse'),
        'Intro short-circuit must still exist in non-streaming path'
    );
});

// ---------------------------------------------------------------------------
// 5. Regression: Negotiation coaching short-circuit still works
// ---------------------------------------------------------------------------

test('Regression: negotiation coaching short-circuit preserved in streaming path', () => {
    const streamingSection = extractStreamingKnowledgeSection(LLMHELPER_SOURCE);
    assert.ok(
        streamingSection.includes('knowledgeResult.liveNegotiationResponse'),
        'Negotiation coaching short-circuit must still exist in streaming path'
    );
    // Must execute before evidence guard
    const negotiationPos = streamingSection.indexOf('liveNegotiationResponse');
    const evidencePos = streamingSection.indexOf('hasProfileEvidence');
    assert.ok(
        negotiationPos < evidencePos,
        'Negotiation short-circuit must execute before evidence guard'
    );
});

test('Regression: negotiation coaching short-circuit preserved in non-streaming path', () => {
    const nonStreamingSection = extractNonStreamingKnowledgeSection(LLMHELPER_SOURCE);
    assert.ok(
        nonStreamingSection.includes('knowledgeResult.liveNegotiationResponse'),
        'Negotiation coaching short-circuit must still exist in non-streaming path'
    );
});

// ---------------------------------------------------------------------------
// 6. Regression: Generation guard still works
// ---------------------------------------------------------------------------

test('Regression: generation guard preserved in streaming path', () => {
    const streamingSection = extractStreamingKnowledgeSection(LLMHELPER_SOURCE);
    assert.ok(
        streamingSection.includes('this._knowledgeGenId !== knowledgeGenId'),
        'Generation guard must still exist in streaming path'
    );
    assert.ok(
        streamingSection.includes('session changed during await'),
        'Generation guard log message must still exist'
    );
});

test('Regression: generation guard preserved in non-streaming path', () => {
    const nonStreamingSection = extractNonStreamingKnowledgeSection(LLMHELPER_SOURCE);
    assert.ok(
        nonStreamingSection.includes('this._knowledgeGenId !== knowledgeGenId'),
        'Generation guard must still exist in non-streaming path'
    );
});

// ---------------------------------------------------------------------------
// 7. Prompt-diff validation: "What technologies do you know?"
// ---------------------------------------------------------------------------

test('Prompt-diff: "What technologies do you know?" is NOT in old isProfileQuery regex', () => {
    // This proves the old code would have dropped context for this question
    const oldRegex = /experience|project|salary|behavior|introduce|background|resume|role|team|company|about yourself|why (this|us|here)|tell me about/i;
    const question = 'What technologies do you know?';
    assert.equal(
        oldRegex.test(question),
        false,
        'Old regex must NOT match "What technologies do you know?" — proving P1 bug existed'
    );
});

test('Prompt-diff: old regex blocked valid profile questions', () => {
    const oldRegex = /experience|project|salary|behavior|introduce|background|resume|role|team|company|about yourself|why (this|us|here)|tell me about/i;
    for (const q of NON_REGEX_PROFILE_QUESTIONS) {
        assert.equal(
            oldRegex.test(q),
            false,
            `Old regex must NOT match "${q}" — proving context was silently dropped`
        );
    }
});

test('Prompt-diff: old regex correctly matched some profile questions (regression baseline)', () => {
    const oldRegex = /experience|project|salary|behavior|introduce|background|resume|role|team|company|about yourself|why (this|us|here)|tell me about/i;
    for (const q of REGEX_MATCHING_QUESTIONS) {
        assert.equal(
            oldRegex.test(q),
            true,
            `Old regex should match "${q}" — these still work after fix`
        );
    }
});

test('Prompt-diff: after fix, ALL profile questions get context when evidence exists', () => {
    // The new code has NO regex filter. Verify by confirming the old regex variable declaration
    // is completely absent from the knowledge injection code.
    // (Note: the comments may reference isProfileQuery to explain what was removed.)
    const streamingSection = extractStreamingKnowledgeSection(LLMHELPER_SOURCE);

    // Check for the variable declaration pattern — not comment mentions
    assert.ok(
        !(/const\s+isProfileQuery\s*=/.test(streamingSection)),
        'No isProfileQuery variable declaration should exist in streaming path'
    );

    // The non-streaming path must also lack the variable
    const nonStreamingSection = extractNonStreamingKnowledgeSection(LLMHELPER_SOURCE);
    assert.ok(
        !(/const\s+isProfileQuery\s*=/.test(nonStreamingSection)),
        'No isProfileQuery variable declaration should exist in non-streaming path'
    );

    // Verify the evidence guard is the ONLY gate for context injection
    const contextInjectionGates = streamingSection.match(/if\s*\(.*contextBlock/g) || [];
    for (const gate of contextInjectionGates) {
        assert.ok(
            !gate.includes('isProfileQuery'),
            `Context injection gate "${gate}" must NOT reference isProfileQuery`
        );
    }
});

// ---------------------------------------------------------------------------
// 8. Dossier/AOT-only evidence still permits identity injection
// ---------------------------------------------------------------------------

test('P7: dossier-only context (no resume nodes) permits identity injection', () => {
    // When processQuestion returns:
    //   contextBlock = '<company_research>\nCompany: Acme...\n</company_research>'
    //   (i.e., only dossier context, no resume nodes)
    //   systemPromptInjection = 'You generate interview-ready speech for...'
    //
    // Expected: hasProfileEvidence = true (contextBlock is non-empty)
    //           → identity prompt injected ✓
    //           → dossier context injected ✓
    //
    // This test validates the structural guarantee by verifying the evidence
    // check uses contextBlock.trim() (truthy for any non-whitespace content)
    // rather than checking for specific resume node markers.

    const streamingSection = extractStreamingKnowledgeSection(LLMHELPER_SOURCE);

    // Evidence check must use generic content check, not resume-specific check
    assert.ok(
        streamingSection.includes(`knowledgeResult.contextBlock?.trim()`),
        'Evidence check must use generic contextBlock.trim(), not resume-specific markers'
    );

    // Verify there is NO resume-specific evidence check
    assert.ok(
        !streamingSection.includes('candidate_experience'),
        'Evidence check must NOT look for specific XML tags like candidate_experience'
    );
    assert.ok(
        !streamingSection.includes('source_type'),
        'Evidence check must NOT filter by source_type'
    );
    assert.ok(
        !streamingSection.includes('DocType.RESUME'),
        'Evidence check must NOT reference DocType.RESUME'
    );
});

test('P7: AOT-only context (gap pivots, mock hints, culture) permits identity injection', () => {
    // AOT artifacts (gap_pivot_scripts, mock_question_hint, culture alignment)
    // are appended to contextBlock by KnowledgeOrchestrator even when no resume
    // nodes are returned. The evidence check must allow these.

    // Structural proof: the evidence check is:
    //   Boolean(knowledgeResult.contextBlock?.trim()) || Boolean(knowledgeResult.directResponse)
    //
    // Any non-empty contextBlock passes — including AOT-only blocks.
    // This test verifies the check is content-agnostic.

    const nonStreamingSection = extractNonStreamingKnowledgeSection(LLMHELPER_SOURCE);

    // The evidence variable must be computed from contextBlock content, not structure
    const evidenceComputation = nonStreamingSection.match(/const hasProfileEvidence\s*=[\s\S]*?;/);
    assert.ok(evidenceComputation, 'Must find hasProfileEvidence assignment');
    const evidenceLine = evidenceComputation![0];

    // It must NOT check for specific node types or categories
    assert.ok(
        !evidenceLine.includes('resume'),
        'Evidence computation must NOT reference resume specifically'
    );
    assert.ok(
        !evidenceLine.includes('node'),
        'Evidence computation must NOT reference nodes specifically'
    );

    // It must check for any truthy content
    assert.ok(
        evidenceLine.includes('contextBlock?.trim()'),
        'Evidence computation must check for any non-whitespace content'
    );
});

test('P7: directResponse alone permits identity injection (without contextBlock)', () => {
    // If processQuestion returns { systemPromptInjection: '...', contextBlock: '', directResponse: 'answer' }
    // hasProfileEvidence should be true because directResponse is truthy.
    // This is the future-proof path for when KnowledgeOrchestrator adds direct responses.

    const streamingSection = extractStreamingKnowledgeSection(LLMHELPER_SOURCE);
    const evidenceComputation = streamingSection.match(/const hasProfileEvidence\s*=[\s\S]*?;/);
    assert.ok(evidenceComputation, 'Must find hasProfileEvidence assignment');
    const evidenceLine = evidenceComputation![0];

    // directResponse must be checked with OR (||) so either path permits injection
    assert.ok(
        evidenceLine.includes('||'),
        'Evidence check must use OR to allow either contextBlock or directResponse'
    );
    assert.ok(
        evidenceLine.includes('directResponse'),
        'Evidence check must include directResponse'
    );
});

// ---------------------------------------------------------------------------
// Hallucination prevention proof
// ---------------------------------------------------------------------------

test('Hallucination prevention: empty contextBlock + no directResponse = no identity prompt', () => {
    // This is the core P7 guarantee.
    // Before fix:
    //   systemPromptInjection = 'You generate interview-ready speech for John...' → INJECTED
    //   contextBlock = '' → NOT INJECTED (or dropped by regex)
    //   Result: LLM told "you ARE John" with no John-context → hallucinates resume
    //
    // After fix:
    //   systemPromptInjection = 'You generate interview-ready speech for John...'
    //   contextBlock = '' → hasProfileEvidence = false
    //   Result: systemPromptOverride NOT set → LLM uses default system prompt → no hallucination

    // Structural proof: systemPromptOverride is only set INSIDE the evidence guard
    const streamingSection = extractStreamingKnowledgeSection(LLMHELPER_SOURCE);

    // Find all lines that set systemPromptOverride in the knowledge intercept
    const knowledgeBlock = extractKnowledgeBlock(streamingSection);
    const overrideAssignments = knowledgeBlock.match(/systemPromptOverride\s*=\s*knowledgeResult\.systemPromptInjection/g) || [];

    assert.equal(
        overrideAssignments.length,
        1,
        'systemPromptOverride must be assigned exactly once in the knowledge block'
    );

    // That single assignment must be inside the hasProfileEvidence guard
    const evidencePos = knowledgeBlock.indexOf('hasProfileEvidence');
    const overridePos = knowledgeBlock.indexOf('systemPromptOverride = knowledgeResult.systemPromptInjection');
    assert.ok(
        evidencePos < overridePos,
        'systemPromptOverride assignment must come AFTER hasProfileEvidence check'
    );
});

test('Hallucination prevention: whitespace-only contextBlock is treated as empty', () => {
    // contextBlock = '   \n  ' should NOT count as evidence
    // The check uses contextBlock?.trim() which returns '' for whitespace-only strings
    // Boolean('') === false → hasProfileEvidence = false → suppressed

    const streamingSection = extractStreamingKnowledgeSection(LLMHELPER_SOURCE);
    assert.ok(
        streamingSection.includes('contextBlock?.trim()'),
        'Evidence check must use .trim() to handle whitespace-only contextBlock'
    );
});

// ---------------------------------------------------------------------------
// Source helpers
// ---------------------------------------------------------------------------

function extractStreamingKnowledgeSection(source: string): string {
    // Extract the KNOWLEDGE MODE INTERCEPT (Streaming) block
    const startMarker = 'KNOWLEDGE MODE INTERCEPT (Streaming)';
    const endMarker = 'ACTIVE MODE INJECTION';
    const startIdx = source.indexOf(startMarker);
    const endIdx = source.indexOf(endMarker, startIdx);
    if (startIdx === -1 || endIdx === -1) {
        throw new Error('Could not find streaming knowledge intercept section');
    }
    return source.substring(startIdx, endIdx);
}

function extractNonStreamingKnowledgeSection(source: string): string {
    // Extract the KNOWLEDGE MODE INTERCEPT block in chatWithGemini
    const startMarker = 'KNOWLEDGE MODE INTERCEPT\n';
    const endMarker = 'const isMultimodal';
    const startIdx = source.indexOf(startMarker);
    const endIdx = source.indexOf(endMarker, startIdx);
    if (startIdx === -1 || endIdx === -1) {
        throw new Error('Could not find non-streaming knowledge intercept section');
    }
    return source.substring(startIdx, endIdx);
}

function extractEvidenceBlock(section: string): string {
    // Extract the code block between hasProfileEvidence and the closing else/catch
    const startIdx = section.indexOf('hasProfileEvidence');
    if (startIdx === -1) return '';
    const endIdx = section.indexOf('Profile identity prompt suppressed', startIdx);
    if (endIdx === -1) return section.substring(startIdx);
    return section.substring(startIdx, endIdx);
}

function extractKnowledgeBlock(section: string): string {
    // Extract from the first knowledgeResult check to the catch block
    const startIdx = section.indexOf('knowledgeResult');
    if (startIdx === -1) return '';
    const catchIdx = section.indexOf('catch (knowledgeError', startIdx);
    if (catchIdx === -1) return section.substring(startIdx);
    return section.substring(startIdx, catchIdx);
}
