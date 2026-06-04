{
const test: typeof import('node:test').test = require('node:test').test;
const assert: typeof import('node:assert').strict = require('node:assert').strict;
const fs: typeof import('node:fs') = require('node:fs');
const path: typeof import('node:path') = require('node:path');
const Module = require('node:module');
const ts: typeof import('typescript') = require('typescript');

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveWithTsExtension(request: string, parent: any, isMain: boolean, options: any) {
    try {
        return originalResolveFilename.call(this, request, parent, isMain, options);
    } catch (error) {
        if ((request.startsWith('.') || request.startsWith('/')) && !path.extname(request)) {
            return originalResolveFilename.call(this, `${request}.ts`, parent, isMain, options);
        }
        throw error;
    }
};

(require as any).extensions['.ts'] = function compileTsForNodeTest(module: any, filename: string) {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            esModuleInterop: true,
        },
    }).outputText;
    module._compile(output, filename);
};

const {
    KnowledgeDatabaseManager,
} = require(path.join(process.cwd(), 'premium/electron/knowledge/KnowledgeDatabaseManager.ts')) as typeof import('../../premium/electron/knowledge/KnowledgeDatabaseManager');
const {
    AOTPipeline,
} = require(path.join(process.cwd(), 'premium/electron/knowledge/AOTPipeline.ts')) as typeof import('../../premium/electron/knowledge/AOTPipeline');
const {
    createProfilePairFingerprint,
} = require(path.join(process.cwd(), 'premium/electron/knowledge/NegotiationEngine.ts')) as typeof import('../../premium/electron/knowledge/NegotiationEngine');
const {
    DocType,
} = require(path.join(process.cwd(), 'premium/electron/knowledge/types.ts')) as typeof import('../../premium/electron/knowledge/types');

type AOTInputIdentity = import('../../premium/electron/knowledge/KnowledgeDatabaseManager').AOTInputIdentity;
type ContextNode = import('../../premium/electron/knowledge/types').ContextNode;
type KnowledgeDocument = import('../../premium/electron/knowledge/types').KnowledgeDocument;
type DocTypeValue = import('../../premium/electron/knowledge/types').DocType;

class FakeStatement {
    private readonly db: FakeDatabase;
    private readonly sql: string;

    constructor(db: FakeDatabase, sql: string) {
        this.db = db;
        this.sql = sql;
    }

    run(...params: any[]) {
        return this.db.run(this.sql, params);
    }

    get(...params: any[]) {
        return this.db.get(this.sql, params);
    }

    all(...params: any[]) {
        return this.db.all(this.sql, params);
    }
}

class FakeDatabase {
    private nextDocumentId = 1;
    private nextNodeId = 1;
    private nextAotId = 1;
    private readonly knowledgeDocuments: any[] = [];
    private readonly contextNodes: any[] = [];
    private readonly aotResults: any[] = [];
    private readonly knowledgeMeta = new Map<string, string>();

    prepare(sql: string) {
        return new FakeStatement(this, sql);
    }

    exec(_sql: string) {
        return this;
    }

    transaction<T extends (...args: any[]) => any>(fn: T): T {
        return ((...args: any[]) => fn(...args)) as T;
    }

    run(sql: string, params: any[]) {
        const normalized = normalizeAotSql(sql);

        if (normalized.startsWith('insert into knowledge_documents')) {
            const [type, sourceUri, structuredData] = params;
            const id = this.nextDocumentId++;
            this.knowledgeDocuments.push({
                id,
                type,
                source_uri: sourceUri,
                structured_data: structuredData,
                created_at: `2026-01-01 00:00:${String(id).padStart(2, '0')}`,
            });
            return { lastInsertRowid: id, changes: 1 };
        }

        if (normalized.startsWith('insert into context_nodes')) {
            const [
                documentId,
                sourceType,
                category,
                title,
                organization,
                startDate,
                endDate,
                durationMonths,
                textContent,
                tags,
                embedding,
            ] = params;
            const id = this.nextNodeId++;
            this.contextNodes.push({
                id,
                document_id: documentId,
                source_type: sourceType,
                category,
                title,
                organization,
                start_date: startDate,
                end_date: endDate,
                duration_months: durationMonths,
                text_content: textContent,
                tags,
                embedding,
            });
            return { lastInsertRowid: id, changes: 1 };
        }

        if (normalized.startsWith('insert into knowledge_meta')) {
            const [key, value] = params;
            this.knowledgeMeta.set(key, value);
            return { changes: 1 };
        }

        if (normalized.startsWith('delete from aot_results where document_id = ? and result_type = ? and coalesce(pair_fingerprint')) {
            const [documentId, resultType, pairFingerprint] = params;
            return this.deleteAotRows((row) =>
                row.document_id === documentId
                && row.result_type === resultType
                && (row.pair_fingerprint ?? '') !== pairFingerprint
            );
        }

        if (normalized.startsWith('delete from aot_results where document_id = ? and result_type = ? and coalesce(input_hash')) {
            const [documentId, resultType, inputHash] = params;
            return this.deleteAotRows((row) =>
                row.document_id === documentId
                && row.result_type === resultType
                && (row.input_hash ?? '') !== inputHash
            );
        }

        if (normalized.startsWith('delete from aot_results where result_type = ?')) {
            return { changes: 0 };
        }

        if (normalized.startsWith('insert into aot_results')) {
            if (params.length === 9) {
                const [
                    documentId,
                    resultType,
                    resultJson,
                    inputHash,
                    inputLength,
                    inputChecksum,
                    pairFingerprint,
                    resumeFingerprint,
                    jdFingerprint,
                ] = params;
                const id = this.nextAotId++;
                this.aotResults.push({
                    id,
                    document_id: documentId,
                    result_type: resultType,
                    result_json: resultJson,
                    input_hash: inputHash,
                    input_length: inputLength,
                    input_checksum: inputChecksum,
                    pair_fingerprint: pairFingerprint,
                    resume_fingerprint: resumeFingerprint,
                    jd_fingerprint: jdFingerprint,
                    created_at: `2026-01-01 00:10:${String(id).padStart(2, '0')}`,
                    updated_at: `2026-01-01 00:10:${String(id).padStart(2, '0')}`,
                    version: 1,
                });
                return { lastInsertRowid: id, changes: 1 };
            }

            const [documentId, resultType, resultJson, inputChecksum] = params;
            const id = this.nextAotId++;
            this.aotResults.push({
                id,
                document_id: documentId,
                result_type: resultType,
                result_json: resultJson,
                input_hash: null,
                input_length: null,
                input_checksum: inputChecksum,
                pair_fingerprint: null,
                resume_fingerprint: null,
                jd_fingerprint: null,
                created_at: `2026-01-01 00:10:${String(id).padStart(2, '0')}`,
                updated_at: `2026-01-01 00:10:${String(id).padStart(2, '0')}`,
                version: 1,
            });
            return { lastInsertRowid: id, changes: 1 };
        }

        if (normalized.startsWith('update aot_results set document_id = ?')) {
            const [
                documentId,
                resultJson,
                inputHash,
                inputLength,
                inputChecksum,
                pairFingerprint,
                resumeFingerprint,
                jdFingerprint,
                rowId,
            ] = params;
            const row = this.aotResults.find((entry) => entry.id === rowId);
            if (!row) return { changes: 0 };
            Object.assign(row, {
                document_id: documentId,
                result_json: resultJson,
                input_hash: inputHash,
                input_length: inputLength,
                input_checksum: inputChecksum,
                pair_fingerprint: pairFingerprint,
                resume_fingerprint: resumeFingerprint,
                jd_fingerprint: jdFingerprint,
                updated_at: `2026-01-01 00:20:${String(rowId).padStart(2, '0')}`,
                version: (row.version || 1) + 1,
            });
            return { changes: 1 };
        }

        if (normalized.startsWith('update aot_results set result_json = ?')) {
            const [resultJson, inputChecksum, rowId] = params;
            const row = this.aotResults.find((entry) => entry.id === rowId);
            if (!row) return { changes: 0 };
            row.result_json = resultJson;
            row.input_checksum = inputChecksum;
            row.version = (row.version || 1) + 1;
            return { changes: 1 };
        }

        return { changes: 0 };
    }

    get(sql: string, params: any[]) {
        const normalized = normalizeAotSql(sql);

        if (normalized.startsWith('select * from knowledge_documents where id = ?')) {
            const [id] = params;
            return this.knowledgeDocuments.find((doc) => doc.id === id);
        }

        if (normalized.startsWith('select * from knowledge_documents where type = ?')) {
            const [type] = params;
            return [...this.knowledgeDocuments]
                .filter((doc) => doc.type === type)
                .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
        }

        if (normalized.startsWith('select value from knowledge_meta')) {
            const [key] = params;
            const value = this.knowledgeMeta.get(key);
            return value === undefined ? undefined : { value };
        }

        if (normalized.includes('from aot_results')) {
            return this.selectAotRow(normalized, params);
        }

        return undefined;
    }

    all(sql: string, params: any[]) {
        const normalized = normalizeAotSql(sql);

        if (normalized.startsWith('select * from context_nodes where document_id = ? and source_type = ?')) {
            const [documentId, sourceType] = params;
            return this.contextNodes
                .filter((node) => node.document_id === documentId && node.source_type === sourceType)
                .sort((a, b) => a.id - b.id);
        }

        if (normalized.startsWith('select * from context_nodes where document_id = ?')) {
            const [documentId] = params;
            return this.contextNodes
                .filter((node) => node.document_id === documentId)
                .sort((a, b) => a.id - b.id);
        }

        if (normalized.startsWith('select * from context_nodes where source_type = ?')) {
            const [sourceType] = params;
            return this.contextNodes
                .filter((node) => node.source_type === sourceType)
                .sort((a, b) => a.id - b.id);
        }

        if (normalized.startsWith('select distinct result_type from aot_results')) {
            return [...new Set(this.aotResults.map((row) => row.result_type))].map((result_type) => ({ result_type }));
        }

        return [];
    }

    private deleteAotRows(predicate: (row: any) => boolean) {
        let changes = 0;
        for (let i = this.aotResults.length - 1; i >= 0; i--) {
            if (predicate(this.aotResults[i])) {
                this.aotResults.splice(i, 1);
                changes++;
            }
        }
        return { changes };
    }

    private selectAotRow(normalized: string, params: any[]) {
        let rows = [...this.aotResults];

        if (normalized.includes('where result_type = ? and pair_fingerprint = ?')) {
            const [resultType, pairFingerprint] = params;
            rows = rows.filter((row) => row.result_type === resultType && row.pair_fingerprint === pairFingerprint);
        } else if (normalized.includes('where result_type = ? and input_hash = ?')) {
            const [resultType, inputHash] = params;
            rows = rows.filter((row) => row.result_type === resultType && row.input_hash === inputHash);
        } else if (normalized.includes('where document_id = ? and result_type = ? and pair_fingerprint = ?')) {
            const [documentId, resultType, pairFingerprint] = params;
            rows = rows.filter((row) =>
                row.document_id === documentId
                && row.result_type === resultType
                && row.pair_fingerprint === pairFingerprint
            );
        } else if (normalized.includes('where document_id = ? and result_type = ? and input_hash = ?')) {
            const [documentId, resultType, inputHash] = params;
            rows = rows.filter((row) =>
                row.document_id === documentId
                && row.result_type === resultType
                && row.input_hash === inputHash
            );
        } else if (normalized.includes('where document_id = ? and result_type = ? and input_hash is null')) {
            const [documentId, resultType] = params;
            rows = rows.filter((row) =>
                row.document_id === documentId
                && row.result_type === resultType
                && row.input_hash === null
            );
        } else if (normalized.includes('where document_id = ? and result_type = ?')) {
            const [documentId, resultType] = params;
            rows = rows.filter((row) => row.document_id === documentId && row.result_type === resultType);
        }

        return rows.sort((a, b) => b.id - a.id)[0];
    }
}

function normalizeAotSql(sql: string): string {
    return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

function createAotManager(): any {
    return new KnowledgeDatabaseManager(new FakeDatabase() as any);
}

function aotResume(name: string) {
    return {
        identity: { name },
        skills: ['TypeScript'],
        experience: [{ company: 'Acme', role: 'Engineer', start_date: '2020-01', end_date: null as string | null, bullets: ['Built systems'] }],
        projects: [] as any[],
        education: [] as any[],
        achievements: [] as any[],
        certifications: [] as any[],
        leadership: [] as any[],
    };
}

function aotJD(title: string, company = 'Amazon') {
    return {
        title,
        company,
        location: 'Remote',
        description_summary: `${title} at ${company}`,
        level: 'senior',
        employment_type: 'full_time',
        min_years_experience: 5,
        compensation_hint: '',
        requirements: ['TypeScript'],
        nice_to_haves: [] as string[],
        responsibilities: [] as string[],
        technologies: ['Node.js'],
        keywords: ['backend'],
    };
}

function saveAotDocument(manager: any, type: DocTypeValue, structuredData: any): KnowledgeDocument {
    const id = manager.saveDocument({
        type,
        source_uri: `/tmp/${type}-${Date.now()}.json`,
        structured_data: structuredData,
    });
    return manager.getDocumentById(id)!;
}

function aotStarNode(textContent: string): ContextNode {
    return {
        source_type: DocType.RESUME,
        category: 'star_story',
        title: 'STAR: Engineer at Acme',
        organization: 'Acme',
        start_date: '2020-01',
        end_date: null,
        duration_months: 24,
        text_content: textContent,
        tags: ['star_story'],
        embedding: [1, 0, 0],
    };
}

function aotCulture(company: string, label: string) {
    return {
        company,
        core_values: ['Ownership'],
        mappings: [{
            story_id: label,
            original_bullet: label,
            parent_role: 'Engineer',
            parent_company: 'Acme',
            value_name: 'Ownership',
            alignment_score: 0.9,
            alignment_rationale: `${label} rationale`,
            speaking_tip: `${label} tip`,
        }],
        unmapped_values: [] as string[],
        mapped_at: '2026-06-04T00:00:00.000Z',
    };
}

function aotIdentity(resumeDoc: KnowledgeDocument, jdDoc: KnowledgeDocument): AOTInputIdentity {
    const inputIdentity = createProfilePairFingerprint(resumeDoc, jdDoc);
    assert.ok(inputIdentity?.pairFingerprint);
    assert.ok(inputIdentity.resumeFingerprint);
    assert.ok(inputIdentity.jdFingerprint);
    return inputIdentity;
}

function createAotPipeline(manager: any): any {
    const pipeline = new AOTPipeline(manager, { getCachedDossier: (): null => null } as any);
    pipeline.setGenerateContentFn(async () => JSON.stringify([{
        story_index: 0,
        original_bullet: 'generated culture story',
        value_name: 'Ownership',
        alignment_score: 0.91,
        alignment_rationale: 'Generated for active pair',
        speaking_tip: 'Use the active story.',
    }]));
    return pipeline;
}

test('Resume replacement ignores old culture mapping and generates new pair-scoped mapping', async () => {
    const manager = createAotManager();
    const resumeA = saveAotDocument(manager, DocType.RESUME, aotResume('Resume A'));
    const resumeB = saveAotDocument(manager, DocType.RESUME, aotResume('Resume B'));
    const jdX = saveAotDocument(manager, DocType.JD, aotJD('JD X'));
    const identityA = aotIdentity(resumeA, jdX);
    const identityB = aotIdentity(resumeB, jdX);

    manager.saveCultureMappingsWithHash(jdX.id!, aotCulture('Amazon', 'old resume mapping'), identityA);
    manager.saveNodes([aotStarNode('Resume B STAR story')], resumeB.id);

    assert.equal(manager.getCultureMappings(jdX.id!, identityB), null);

    const pipeline = createAotPipeline(manager);
    await (pipeline as any).preComputeCultureMapping(jdX, resumeB);

    const generated = manager.getCultureMappings(jdX.id!, identityB);
    assert.equal(generated?.mappings?.[0]?.alignment_rationale, 'Generated for active pair');
    assert.equal(manager.getCultureMappings(jdX.id!, identityA), null);
});

test('JD replacement ignores old culture mapping and generates new pair-scoped mapping', async () => {
    const manager = createAotManager();
    const resumeA = saveAotDocument(manager, DocType.RESUME, aotResume('Resume A'));
    const jdX = saveAotDocument(manager, DocType.JD, aotJD('JD X', 'Amazon'));
    const jdY = saveAotDocument(manager, DocType.JD, aotJD('JD Y', 'Amazon'));
    const identityX = aotIdentity(resumeA, jdX);
    const identityY = aotIdentity(resumeA, jdY);

    manager.saveCultureMappingsWithHash(jdX.id!, aotCulture('Amazon', 'old jd mapping'), identityX);
    manager.saveNodes([aotStarNode('Resume A STAR story')], resumeA.id);

    assert.equal(manager.getCultureMappings(jdY.id!, identityY), null);

    const pipeline = createAotPipeline(manager);
    await (pipeline as any).preComputeCultureMapping(jdY, resumeA);

    const generated = manager.getCultureMappings(jdY.id!, identityY);
    assert.equal(generated?.mappings?.[0]?.alignment_rationale, 'Generated for active pair');
    assert.equal(manager.getCultureMappings(jdY.id!, identityX), null);
});

test('Fingerprint mismatch rejects cached AOT artifacts', () => {
    const manager = createAotManager();
    const resumeA = saveAotDocument(manager, DocType.RESUME, aotResume('Resume A'));
    const resumeB = saveAotDocument(manager, DocType.RESUME, aotResume('Resume B'));
    const jdX = saveAotDocument(manager, DocType.JD, aotJD('JD X'));
    const identityA = aotIdentity(resumeA, jdX);
    const identityB = aotIdentity(resumeB, jdX);

    manager.saveNegotiationScript(jdX.id!, { opening: 'A', objection_responses: [], counter_offer_fallback: '', salary_range: null, sources: [] }, identityA);
    manager.saveGapAnalysisWithHash(jdX.id!, { match_percentage: 90, gaps: [], strengths: [], recommendations: [] }, identityA);
    manager.saveMockQuestionsWithHash(jdX.id!, [{ question: 'A?', category: 'technical', difficulty: 'easy', rationale: '', suggested_answer_key: '' }], identityA);
    manager.saveCultureMappingsWithHash(jdX.id!, aotCulture('Amazon', 'A culture'), identityA);

    assert.notEqual(manager.getNegotiationScript(jdX.id!, identityA), null);
    assert.equal(manager.getNegotiationScript(jdX.id!, identityB), null);
    assert.equal(manager.getGapAnalysis(jdX.id!, identityB), null);
    assert.equal(manager.getMockQuestions(jdX.id!, identityB), null);
    assert.equal(manager.getCultureMappings(jdX.id!, identityB), null);
});

test('Restart restore loads only active pair fingerprint AOT', () => {
    const backingDb = new FakeDatabase();
    const manager = new KnowledgeDatabaseManager(backingDb as any);
    const resumeActive = saveAotDocument(manager, DocType.RESUME, aotResume('Active Resume'));
    const jdActive = saveAotDocument(manager, DocType.JD, aotJD('Active JD'));
    const activeIdentity = aotIdentity(resumeActive, jdActive);

    manager.saveNegotiationScript(jdActive.id!, { opening: 'active', objection_responses: [], counter_offer_fallback: '', salary_range: null, sources: [] }, activeIdentity);
    manager.saveGapAnalysisWithHash(jdActive.id!, { match_percentage: 95, gaps: [], strengths: ['active'], recommendations: [] }, activeIdentity);
    manager.saveMockQuestionsWithHash(jdActive.id!, [{ question: 'active?', category: 'technical', difficulty: 'easy', rationale: '', suggested_answer_key: '' }], activeIdentity);
    manager.saveCultureMappingsWithHash(jdActive.id!, aotCulture('Amazon', 'active culture'), activeIdentity);

    const restartedManager = new KnowledgeDatabaseManager(backingDb as any);
    const pipeline = new AOTPipeline(restartedManager, { getCachedDossier: (): null => null } as any);
    const restore = pipeline.initializeFromStoredData(jdActive, resumeActive);

    assert.equal(restore.restoredOutputs.negotiationScript, true);
    assert.equal(restore.restoredOutputs.gapAnalysis, true);
    assert.equal(restore.restoredOutputs.questions, true);
    assert.equal(restore.restoredOutputs.cultureMapping, true);
    assert.equal(restore.needsGeneration, false);
    assert.equal(pipeline.getCachedCultureMapping()?.mappings?.[0]?.original_bullet, 'active culture');
});
}
