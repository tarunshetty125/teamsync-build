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
    DocType,
} = require(path.join(process.cwd(), 'premium/electron/knowledge/types.ts')) as typeof import('../../premium/electron/knowledge/types');

type DocumentLifecycleState = import('../../premium/electron/knowledge/types').DocumentLifecycleState;
type DocTypeValue = import('../../premium/electron/knowledge/types').DocType;
type StructuredResume = import('../../premium/electron/knowledge/types').StructuredResume;
type StructuredJD = import('../../premium/electron/knowledge/types').StructuredJD;

class ReplacementStatement {
    private readonly db: ReplacementDatabase;
    private readonly sql: string;

    constructor(db: ReplacementDatabase, sql: string) {
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

class ReplacementDatabase {
    private nextDocumentId = 1;
    private readonly documents: any[] = [];
    private readonly knowledgeMeta = new Map<string, string>();
    private activeState: any | null = null;

    prepare(sql: string) {
        return new ReplacementStatement(this, sql);
    }

    exec(_sql: string) {
        return this;
    }

    transaction<T extends (...args: any[]) => any>(fn: T): T {
        return ((...args: any[]) => fn(...args)) as T;
    }

    run(sql: string, params: any[]) {
        const normalized = normalizeReplacementSql(sql);

        if (normalized.startsWith('insert into knowledge_documents')) {
            const id = this.nextDocumentId++;
            if (params.length === 5) {
                const [type, sourceUri, structuredData, lifecycleState, lifecycleGenerationId] = params;
                this.documents.push({
                    id,
                    type,
                    source_uri: sourceUri,
                    structured_data: structuredData,
                    lifecycle_state: lifecycleState,
                    lifecycle_generation_id: lifecycleGenerationId,
                    lifecycle_updated_at: `2026-01-01 00:10:${String(id).padStart(2, '0')}`,
                    created_at: `2026-01-01 00:10:${String(id).padStart(2, '0')}`,
                });
                return { lastInsertRowid: id, changes: 1 };
            }
            const [type, sourceUri, structuredData] = params;
            this.documents.push({
                id,
                type,
                source_uri: sourceUri,
                structured_data: structuredData,
                lifecycle_state: 'active',
                lifecycle_generation_id: null,
                lifecycle_updated_at: `2026-01-01 00:00:${String(id).padStart(2, '0')}`,
                created_at: `2026-01-01 00:00:${String(id).padStart(2, '0')}`,
            });
            return { lastInsertRowid: id, changes: 1 };
        }

        if (normalized.startsWith('insert into profile_active_state')) {
            const [activeResumeId, activeJdId, activeProfilePairId, generationId, activeGenerationToken] = params.length === 5
                ? params
                : [params[0], params[1], null, params[2], null];
            this.activeState = {
                id: 1,
                active_resume_id: activeResumeId,
                active_jd_id: activeJdId,
                active_profile_pair_id: activeProfilePairId,
                generation_id: generationId,
                active_generation_token: activeGenerationToken,
                updated_at: '2026-01-01 00:00:00',
            };
            return { changes: 1 };
        }

        if (normalized.startsWith('insert into knowledge_meta')) {
            const [key, value] = params;
            this.knowledgeMeta.set(key, value);
            return { changes: 1 };
        }

        if (
            normalized.startsWith('update knowledge_documents set lifecycle_state = ?, lifecycle_updated_at = datetime')
            && normalized.includes('where type = ?')
        ) {
            const [nextState, type, keepId, expectedState] = params;
            let changes = 0;
            for (const row of this.documents) {
                if (row.type === type && row.id !== keepId && (row.lifecycle_state || 'active') === expectedState) {
                    row.lifecycle_state = nextState;
                    row.lifecycle_updated_at = '2026-01-01 00:25:00';
                    changes++;
                }
            }
            return { changes };
        }

        if (
            normalized.startsWith('update knowledge_documents set lifecycle_state = ?, lifecycle_updated_at = datetime')
            && normalized.includes('where id = ?')
        ) {
            const [nextState, id, expectedState] = params;
            const row = this.documents.find((document) => document.id === id);
            if (!row || (row.lifecycle_state || 'active') !== expectedState) return { changes: 0 };
            row.lifecycle_state = nextState;
            row.lifecycle_updated_at = '2026-01-01 00:20:00';
            return { changes: 1 };
        }

        if (normalized.startsWith('update knowledge_documents set lifecycle_state = ?, lifecycle_generation_id = ?')) {
            const [nextState, lifecycleGenerationId, id] = params;
            const row = this.documents.find((document) => document.id === id);
            if (!row) return { changes: 0 };
            row.lifecycle_state = nextState;
            row.lifecycle_generation_id = lifecycleGenerationId;
            row.lifecycle_updated_at = '2026-01-01 00:30:00';
            return { changes: 1 };
        }

        if (normalized.startsWith('delete from knowledge_documents where type = ?')) {
            const [type] = params;
            let changes = 0;
            for (let i = this.documents.length - 1; i >= 0; i--) {
                if (this.documents[i].type === type) {
                    this.documents.splice(i, 1);
                    changes++;
                }
            }
            return { changes };
        }

        if (normalized.startsWith('delete from knowledge_documents where id = ?')) {
            const [id] = params;
            const index = this.documents.findIndex((document) => document.id === id);
            if (index >= 0) {
                this.documents.splice(index, 1);
                return { changes: 1 };
            }
            return { changes: 0 };
        }

        return { changes: 0 };
    }

    get(sql: string, params: any[]) {
        const normalized = normalizeReplacementSql(sql);

        if (normalized.startsWith('select id from profile_active_state')) {
            return this.activeState ? { id: 1 } : undefined;
        }

        if (normalized.startsWith('select active_resume_id')) {
            return this.activeState ?? undefined;
        }

        if (normalized.startsWith('select lifecycle_state from knowledge_documents where id = ?')) {
            const [id] = params;
            const row = this.documents.find((document) => document.id === id);
            return row ? { lifecycle_state: row.lifecycle_state } : undefined;
        }

        if (normalized.startsWith('select id, type, lifecycle_state from knowledge_documents')) {
            const [id, type, lifecycleState] = params;
            return this.documents.find((document) =>
                document.id === id
                && document.type === type
                && document.lifecycle_state === lifecycleState
            );
        }

        if (normalized.startsWith('select * from knowledge_documents where id = ?')) {
            const [id] = params;
            return this.documents.find((document) => document.id === id);
        }

        if (normalized.startsWith('select * from knowledge_documents where type = ?')) {
            const [type, lifecycleState] = params;
            return [...this.documents]
                .filter((document) =>
                    document.type === type
                    && (!normalized.includes('lifecycle_state') || (document.lifecycle_state || 'active') === lifecycleState)
                )
                .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id)[0];
        }

        if (normalized.startsWith('select value from knowledge_meta')) {
            const [key] = params;
            const value = this.knowledgeMeta.get(key);
            return value === undefined ? undefined : { value };
        }

        return undefined;
    }

    all(sql: string, _params: any[] = []) {
        const normalized = normalizeReplacementSql(sql);

        if (normalized.startsWith('pragma table_info(knowledge_documents)')) {
            return [
                { name: 'id' },
                { name: 'type' },
                { name: 'source_uri' },
                { name: 'structured_data' },
                { name: 'lifecycle_state' },
                { name: 'lifecycle_generation_id' },
                { name: 'lifecycle_updated_at' },
                { name: 'created_at' },
            ];
        }

        if (normalized.startsWith('pragma table_info(profile_active_state)')) {
            return [
                { name: 'id' },
                { name: 'active_resume_id' },
                { name: 'active_jd_id' },
                { name: 'active_profile_pair_id' },
                { name: 'generation_id' },
                { name: 'active_generation_token' },
                { name: 'updated_at' },
            ];
        }

        if (normalized.startsWith('pragma table_info(company_dossiers)')) {
            return [
                { name: 'dossier_scope' },
                { name: 'pair_fingerprint' },
                { name: 'resume_fingerprint' },
                { name: 'jd_fingerprint' },
            ];
        }

        if (normalized.startsWith('pragma table_info(aot_results)')) {
            return [
                { name: 'input_hash' },
                { name: 'input_length' },
                { name: 'input_checksum' },
                { name: 'pair_fingerprint' },
                { name: 'resume_fingerprint' },
                { name: 'jd_fingerprint' },
                { name: 'updated_at' },
                { name: 'version' },
            ];
        }

        if (normalized.startsWith('pragma index_list(company_dossiers)')) {
            return [];
        }

        if (normalized.startsWith('select id, dossier_json from company_dossiers')) {
            return [];
        }

        if (normalized.startsWith('select distinct result_type from aot_results')) {
            return [];
        }

        if (normalized.startsWith('select * from context_nodes where document_id in')) {
            return [];
        }

        return [];
    }
}

function normalizeReplacementSql(sql: string): string {
    return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

function replacementManager() {
    const db = new ReplacementDatabase();
    const manager = new KnowledgeDatabaseManager(db as any);
    manager.initializeSchema();
    return { db, manager };
}

function replacementResume(name: string): StructuredResume {
    return {
        identity: { name },
        skills: ['TypeScript'],
        experience: [],
        projects: [],
        education: [],
        achievements: [],
        certifications: [],
        leadership: [],
    };
}

function replacementJD(title: string, company = 'Acme'): StructuredJD {
    return {
        title,
        company,
        location: 'Remote',
        description_summary: title,
        level: 'mid',
        employment_type: 'full_time',
        min_years_experience: 3,
        compensation_hint: '',
        requirements: [],
        nice_to_haves: [],
        responsibilities: [],
        technologies: [],
        keywords: [title],
    };
}

function saveActiveDocument(manager: any, type: DocTypeValue, structuredData: any): number {
    return manager.saveDocument({
        type,
        source_uri: `/tmp/${type}-active.txt`,
        structured_data: structuredData,
    });
}

function saveStagedDocument(manager: any, type: DocTypeValue, structuredData: any, generationId: number): number {
    return manager.saveStagedDocument({
        type,
        source_uri: `/tmp/${type}-staged.txt`,
        structured_data: structuredData,
    }, generationId);
}

test('Resume replace keeps Resume A active until staged Resume B promotion', () => {
    const { manager } = replacementManager();
    const generationId = 101;
    const resumeAId = saveActiveDocument(manager, DocType.RESUME, replacementResume('Resume A'));
    manager.setCurrentGenerationId(generationId);
    manager.setActiveProfileState({ activeResumeId: resumeAId });

    const resumeBId = saveStagedDocument(manager, DocType.RESUME, replacementResume('Resume B'), generationId);

    assert.equal(manager.getActiveResume()?.id, resumeAId);
    assert.equal(manager.getDocumentLifecycleState(resumeBId), 'staged');
    assert.equal(manager.promoteStagedDocument(DocType.RESUME, resumeBId, generationId), true);
    assert.equal(manager.getActiveResume()?.id, resumeBId);
    assert.equal(manager.getDocumentLifecycleState(resumeAId), 'superseded');
    assert.equal(manager.getDocumentLifecycleState(resumeBId), 'active');
});

test('JD replace keeps JD A active until staged JD B promotion', () => {
    const { manager } = replacementManager();
    const generationId = 202;
    const jdAId = saveActiveDocument(manager, DocType.JD, replacementJD('JD A'));
    manager.setCurrentGenerationId(generationId);
    manager.setActiveProfileState({ activeJDId: jdAId });

    const jdBId = saveStagedDocument(manager, DocType.JD, replacementJD('JD B'), generationId);

    assert.equal(manager.getActiveJD()?.id, jdAId);
    assert.equal(manager.getDocumentLifecycleState(jdBId), 'staged');
    assert.equal(manager.promoteStagedDocument(DocType.JD, jdBId, generationId), true);
    assert.equal(manager.getActiveJD()?.id, jdBId);
    assert.equal(manager.getDocumentLifecycleState(jdAId), 'superseded');
    assert.equal(manager.getDocumentLifecycleState(jdBId), 'active');
});

test('Failed generation hides staged Resume B and leaves Resume A active', () => {
    const { manager } = replacementManager();
    const generationId = 303;
    const resumeAId = saveActiveDocument(manager, DocType.RESUME, replacementResume('Resume A'));
    manager.setCurrentGenerationId(generationId);
    manager.setActiveProfileState({ activeResumeId: resumeAId });
    const resumeBId = saveStagedDocument(manager, DocType.RESUME, replacementResume('Resume B'), generationId);

    manager.markDocumentFailed(resumeBId);

    assert.equal(manager.getActiveResume()?.id, resumeAId);
    assert.equal(manager.getDocumentLifecycleState(resumeBId), 'failed');
    assert.equal(manager.promoteStagedDocument(DocType.RESUME, resumeBId, generationId), false);
});

test('Restart mid generation does not restore staged document as active', () => {
    const { db, manager } = replacementManager();
    const generationId = 404;
    const resumeAId = saveActiveDocument(manager, DocType.RESUME, replacementResume('Resume A'));
    manager.setCurrentGenerationId(generationId);
    manager.setActiveProfileState({ activeResumeId: resumeAId });
    const resumeBId = saveStagedDocument(manager, DocType.RESUME, replacementResume('Resume B'), generationId);

    const restartedManager = new KnowledgeDatabaseManager(db as any);
    restartedManager.initializeSchema();

    assert.equal(restartedManager.getActiveResume()?.id, resumeAId);
    assert.equal(restartedManager.getDocumentLifecycleState(resumeBId), 'staged');
});

test('Delete during generation invalidates staged promotion', () => {
    const { manager } = replacementManager();
    const generationId = 505;
    const resumeAId = saveActiveDocument(manager, DocType.RESUME, replacementResume('Resume A'));
    manager.setCurrentGenerationId(generationId);
    manager.setActiveProfileState({ activeResumeId: resumeAId });
    const resumeBId = saveStagedDocument(manager, DocType.RESUME, replacementResume('Resume B'), generationId);

    manager.setCurrentGenerationId(generationId + 1);

    assert.equal(manager.promoteStagedDocument(DocType.RESUME, resumeBId, generationId), false);
    assert.equal(manager.getActiveResume()?.id, resumeAId);
    assert.equal(manager.getDocumentLifecycleState(resumeBId), 'staged');
});
}
