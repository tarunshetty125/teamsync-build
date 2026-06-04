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
type ContextNode = import('../../premium/electron/knowledge/types').ContextNode;
type DocTypeValue = import('../../premium/electron/knowledge/types').DocType;

function createDb(): any {
    return new FakeDatabase();
}

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
    private readonly knowledgeDocuments: any[] = [];
    private readonly contextNodes: any[] = [];
    private readonly knowledgeMeta = new Map<string, string>();
    private activeState: any | null = null;

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
        const normalized = normalizeSql(sql);

        if (normalized.startsWith('insert into knowledge_documents')) {
            const [type, sourceUri, structuredData, createdAt] = params;
            const id = this.nextDocumentId++;
            this.knowledgeDocuments.push({
                id,
                type,
                source_uri: sourceUri,
                structured_data: structuredData,
                created_at: createdAt || `2026-01-01 00:00:${String(id).padStart(2, '0')}`,
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

        if (normalized.startsWith('insert into profile_active_state')) {
            if (params.length === 3) {
                const [activeResumeId, activeJdId, generationId] = params;
                this.activeState = {
                    id: 1,
                    active_resume_id: activeResumeId,
                    active_jd_id: activeJdId,
                    active_profile_pair_id: null,
                    generation_id: generationId,
                    active_generation_token: null,
                    updated_at: '2026-01-01 00:00:00',
                };
            } else {
                const [activeResumeId, activeJdId, activeProfilePairId, generationId, activeGenerationToken] = params;
                this.activeState = {
                    id: 1,
                    active_resume_id: activeResumeId,
                    active_jd_id: activeJdId,
                    active_profile_pair_id: activeProfilePairId,
                    generation_id: generationId,
                    active_generation_token: activeGenerationToken,
                    updated_at: '2026-01-01 00:00:00',
                };
            }
            return { changes: 1 };
        }

        if (normalized.startsWith('insert into knowledge_meta')) {
            const [key, value] = params;
            this.knowledgeMeta.set(key, value);
            return { changes: 1 };
        }

        if (normalized.startsWith('delete from knowledge_documents where type = ? and id != ?')) {
            const [type, keepDocumentId] = params;
            for (let i = this.knowledgeDocuments.length - 1; i >= 0; i--) {
                if (this.knowledgeDocuments[i].type === type && this.knowledgeDocuments[i].id !== keepDocumentId) {
                    this.knowledgeDocuments.splice(i, 1);
                }
            }
            return { changes: 1 };
        }

        if (normalized.startsWith('delete from knowledge_documents where type = ?')) {
            const [type] = params;
            for (let i = this.knowledgeDocuments.length - 1; i >= 0; i--) {
                if (this.knowledgeDocuments[i].type === type) {
                    this.knowledgeDocuments.splice(i, 1);
                }
            }
            return { changes: 1 };
        }

        if (normalized.startsWith('delete from knowledge_documents where id = ?')) {
            const [id] = params;
            const index = this.knowledgeDocuments.findIndex((doc) => doc.id === id);
            if (index >= 0) this.knowledgeDocuments.splice(index, 1);
            return { changes: index >= 0 ? 1 : 0 };
        }

        return { changes: 0 };
    }

    get(sql: string, params: any[]) {
        const normalized = normalizeSql(sql);

        if (normalized.startsWith('select id from profile_active_state')) {
            return this.activeState ? { id: 1 } : undefined;
        }

        if (normalized.startsWith('select active_resume_id')) {
            return this.activeState ?? undefined;
        }

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

        if (normalized.startsWith('select count(*) as count from knowledge_documents')) {
            return { count: this.knowledgeDocuments.length };
        }

        return undefined;
    }

    all(sql: string, params: any[]) {
        const normalized = normalizeSql(sql);

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

        if (normalized.startsWith('pragma table_info(aot_results)')) {
            return [
                { name: 'id' },
                { name: 'document_id' },
                { name: 'result_type' },
                { name: 'result_json' },
                { name: 'input_hash' },
                { name: 'input_length' },
                { name: 'input_checksum' },
                { name: 'created_at' },
                { name: 'updated_at' },
                { name: 'version' },
            ];
        }

        if (normalized.startsWith('select distinct result_type from aot_results')) {
            return [];
        }

        if (normalized.startsWith('select * from context_nodes where document_id in')) {
            const activeIds = new Set(params);
            return this.contextNodes.filter((node) => activeIds.has(node.document_id));
        }

        if (normalized.startsWith('select * from context_nodes where source_type = ?')) {
            const [sourceType] = params;
            return this.contextNodes.filter((node) => node.source_type === sourceType);
        }

        if (normalized.startsWith('select * from context_nodes order by id asc')) {
            return [...this.contextNodes].sort((a, b) => a.id - b.id);
        }

        return [];
    }
}

function normalizeSql(sql: string): string {
    return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

function createLegacyDocumentsTable(db: any): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS knowledge_documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL,
            source_uri TEXT NOT NULL,
            structured_data TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
}

function resume(name: string) {
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

function jd(title: string, company: string) {
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

function generic(label: string) {
    return { label };
}

function node(sourceType: DocTypeValue, textContent: string): ContextNode {
    return {
        source_type: sourceType,
        category: sourceType === DocType.JD ? 'requirement' : 'experience',
        title: textContent,
        start_date: null,
        end_date: null,
        duration_months: 0,
        text_content: textContent,
        tags: [] as string[],
        embedding: [1, 0, 0],
    };
}

function insertDocument(db: any, type: string, structuredData: any, createdAt: string): number {
    createLegacyDocumentsTable(db);
    const info = db.prepare(`
        INSERT INTO knowledge_documents (type, source_uri, structured_data, created_at)
        VALUES (?, ?, ?, ?)
    `).run(type, `/tmp/${type}-${createdAt}.json`, JSON.stringify(structuredData), createdAt);
    return Number(info.lastInsertRowid);
}

test('Profile active state migration backfills latest legacy resume and JD without deleting rows', () => {
    const db = createDb();
    const oldResumeId = insertDocument(db, DocType.RESUME, resume('Resume A'), '2026-01-01 00:00:00');
    const latestResumeId = insertDocument(db, DocType.RESUME, resume('Resume B'), '2026-01-02 00:00:00');
    const oldJdId = insertDocument(db, DocType.JD, jd('JD A', 'Company A'), '2026-01-01 00:00:00');
    const latestJdId = insertDocument(db, DocType.JD, jd('JD B', 'Company B'), '2026-01-02 00:00:00');

    const manager = new KnowledgeDatabaseManager(db);
    manager.initializeSchema();

    const state = manager.getActiveProfileState();
    const count = db.prepare('SELECT COUNT(*) AS count FROM knowledge_documents').get() as { count: number };

    assert.equal(state.activeResumeId, latestResumeId);
    assert.equal(state.activeJDId, latestJdId);
    assert.equal(state.activeProfilePairId, null);
    assert.equal(state.activeGenerationToken, null);
    assert.equal(count.count, 4);
    assert.ok(oldResumeId > 0);
    assert.ok(oldJdId > 0);
});

test('Profile active state persists active ids, generation id, and active generation token', () => {
    const db = createDb();
    const manager = new KnowledgeDatabaseManager(db);
    manager.initializeSchema();
    const resumeId = manager.saveDocument({ type: DocType.RESUME, source_uri: '/tmp/resume.txt', structured_data: resume('Persisted Resume') });
    const jdId = manager.saveDocument({ type: DocType.JD, source_uri: '/tmp/jd.txt', structured_data: jd('Persisted JD', 'Persisted Co') });

    manager.setActiveProfileState({
        activeResumeId: resumeId,
        activeJDId: jdId,
        activeProfilePairId: 42,
        generationId: 9001,
        activeGenerationToken: 'generation-token-9001',
    });

    const restartedManager = new KnowledgeDatabaseManager(db);
    restartedManager.initializeSchema();
    const state = restartedManager.getActiveProfileState();

    assert.equal(state.activeResumeId, resumeId);
    assert.equal(state.activeJDId, jdId);
    assert.equal(state.activeProfilePairId, 42);
    assert.equal(state.generationId, 9001);
    assert.equal(state.activeGenerationToken, 'generation-token-9001');
    assert.ok(state.updatedAt);
});

test('Restart restore resolves active resume and JD from active state instead of latest rows', () => {
    const db = createDb();
    const olderResumeId = insertDocument(db, DocType.RESUME, resume('Active Resume'), '2026-01-01 00:00:00');
    const latestResumeId = insertDocument(db, DocType.RESUME, resume('Latest Resume'), '2026-01-03 00:00:00');
    const olderJdId = insertDocument(db, DocType.JD, jd('Active JD', 'Active Co'), '2026-01-01 00:00:00');
    const latestJdId = insertDocument(db, DocType.JD, jd('Latest JD', 'Latest Co'), '2026-01-03 00:00:00');

    const manager = new KnowledgeDatabaseManager(db);
    manager.initializeSchema();
    manager.setActiveProfileState({
        activeResumeId: olderResumeId,
        activeJDId: olderJdId,
        generationId: 17,
    });

    const restartedManager = new KnowledgeDatabaseManager(db);
    restartedManager.initializeSchema();

    assert.equal(restartedManager.getActiveResume()?.id, olderResumeId);
    assert.equal(restartedManager.getActiveJD()?.id, olderJdId);
    assert.equal(restartedManager.getDocumentByType(DocType.RESUME)?.id, olderResumeId);
    assert.equal(restartedManager.getDocumentByType(DocType.JD)?.id, olderJdId);
    assert.notEqual(restartedManager.getActiveResume()?.id, latestResumeId);
    assert.notEqual(restartedManager.getActiveJD()?.id, latestJdId);
});

test('Corrupt active ids do not fail startup and fall back to legacy latest resume and JD', () => {
    const db = createDb();
    const latestResumeId = insertDocument(db, DocType.RESUME, resume('Latest Resume'), '2026-01-03 00:00:00');
    const latestJdId = insertDocument(db, DocType.JD, jd('Latest JD', 'Latest Co'), '2026-01-03 00:00:00');

    const manager = new KnowledgeDatabaseManager(db);
    manager.initializeSchema();
    manager.setActiveProfileState({
        activeResumeId: 999_001,
        activeJDId: 999_002,
        generationId: 5,
        activeGenerationToken: 'corrupt-but-stored',
    });

    const restartedManager = new KnowledgeDatabaseManager(db);
    assert.doesNotThrow(() => restartedManager.initializeSchema());

    assert.equal(restartedManager.getActiveResume()?.id, latestResumeId);
    assert.equal(restartedManager.getActiveJD()?.id, latestJdId);
    assert.equal(restartedManager.getActiveProfileState().activeResumeId, 999_001);
    assert.equal(restartedManager.getActiveProfileState().activeJDId, 999_002);
    assert.equal(restartedManager.getActiveProfileState().activeGenerationToken, 'corrupt-but-stored');
});

test('Legacy compatibility preserves latest-row behavior for non-resume and non-JD document types', () => {
    const db = createDb();
    const activeResumeId = insertDocument(db, DocType.RESUME, resume('Active Resume'), '2026-01-01 00:00:00');
    insertDocument(db, DocType.RESUME, resume('Latest Resume'), '2026-01-03 00:00:00');
    const olderGenericId = insertDocument(db, DocType.GENERIC, generic('Generic A'), '2026-01-01 00:00:00');
    const latestGenericId = insertDocument(db, DocType.GENERIC, generic('Generic B'), '2026-01-03 00:00:00');

    const manager = new KnowledgeDatabaseManager(db);
    manager.initializeSchema();
    manager.setActiveProfileState({ activeResumeId });

    assert.equal(manager.getDocumentByType(DocType.RESUME)?.id, activeResumeId);
    assert.equal(manager.getDocumentByType(DocType.GENERIC)?.id, latestGenericId);
    assert.notEqual(manager.getDocumentByType(DocType.GENERIC)?.id, olderGenericId);
});

test('Active retrieval uses only nodes from the active resume document', () => {
    const db = createDb();
    const resumeAId = insertDocument(db, DocType.RESUME, resume('Resume A'), '2026-01-01 00:00:00');
    const resumeBId = insertDocument(db, DocType.RESUME, resume('Resume B'), '2026-01-02 00:00:00');
    const manager = new KnowledgeDatabaseManager(db);
    manager.initializeSchema();

    manager.saveNodes([node(DocType.RESUME, 'Resume A node')], resumeAId);
    manager.saveNodes([node(DocType.RESUME, 'Resume B node')], resumeBId);
    manager.setActiveProfileState({ activeResumeId: resumeBId });

    const nodes = manager.getNodesForActiveProfile();

    assert.deepEqual(nodes.map((entry) => entry.text_content), ['Resume B node']);
    assert.equal(nodes.every((entry) => entry.document_id === resumeBId), true);
});

test('Active retrieval uses only nodes from the active JD document', () => {
    const db = createDb();
    const jdAId = insertDocument(db, DocType.JD, jd('JD A', 'Company A'), '2026-01-01 00:00:00');
    const jdBId = insertDocument(db, DocType.JD, jd('JD B', 'Company B'), '2026-01-02 00:00:00');
    const manager = new KnowledgeDatabaseManager(db);
    manager.initializeSchema();

    manager.saveNodes([node(DocType.JD, 'JD A node')], jdAId);
    manager.saveNodes([node(DocType.JD, 'JD B node')], jdBId);
    manager.setActiveProfileState({ activeJDId: jdBId });

    const nodes = manager.getNodesForActiveProfile();

    assert.deepEqual(nodes.map((entry) => entry.text_content), ['JD B node']);
    assert.equal(nodes.every((entry) => entry.document_id === jdBId), true);
});

test('Active retrieval falls back to latest documents when active ids are corrupt', () => {
    const db = createDb();
    const oldResumeId = insertDocument(db, DocType.RESUME, resume('Old Resume'), '2026-01-01 00:00:00');
    const latestResumeId = insertDocument(db, DocType.RESUME, resume('Latest Resume'), '2026-01-02 00:00:00');
    const oldJdId = insertDocument(db, DocType.JD, jd('Old JD', 'Old Co'), '2026-01-01 00:00:00');
    const latestJdId = insertDocument(db, DocType.JD, jd('Latest JD', 'Latest Co'), '2026-01-02 00:00:00');
    const manager = new KnowledgeDatabaseManager(db);
    manager.initializeSchema();

    manager.saveNodes([node(DocType.RESUME, 'Old Resume node')], oldResumeId);
    manager.saveNodes([node(DocType.RESUME, 'Latest Resume node')], latestResumeId);
    manager.saveNodes([node(DocType.JD, 'Old JD node')], oldJdId);
    manager.saveNodes([node(DocType.JD, 'Latest JD node')], latestJdId);
    manager.setActiveProfileState({ activeResumeId: 999_001, activeJDId: 999_002 });

    const nodes = manager.getNodesForActiveProfile();

    assert.deepEqual(nodes.map((entry) => entry.text_content), ['Latest Resume node', 'Latest JD node']);
    assert.deepEqual(nodes.map((entry) => entry.document_id), [latestResumeId, latestJdId]);
});

test('Startup retrieval restores active-state scoped nodes after restart', () => {
    const db = createDb();
    const activeResumeId = insertDocument(db, DocType.RESUME, resume('Active Resume'), '2026-01-01 00:00:00');
    const latestResumeId = insertDocument(db, DocType.RESUME, resume('Latest Resume'), '2026-01-02 00:00:00');
    const activeJdId = insertDocument(db, DocType.JD, jd('Active JD', 'Active Co'), '2026-01-01 00:00:00');
    const latestJdId = insertDocument(db, DocType.JD, jd('Latest JD', 'Latest Co'), '2026-01-02 00:00:00');
    const manager = new KnowledgeDatabaseManager(db);
    manager.initializeSchema();

    manager.saveNodes([node(DocType.RESUME, 'Active Resume node')], activeResumeId);
    manager.saveNodes([node(DocType.RESUME, 'Latest Resume node')], latestResumeId);
    manager.saveNodes([node(DocType.JD, 'Active JD node')], activeJdId);
    manager.saveNodes([node(DocType.JD, 'Latest JD node')], latestJdId);
    manager.setActiveProfileState({ activeResumeId, activeJDId: activeJdId });

    const restartedManager = new KnowledgeDatabaseManager(db);
    restartedManager.initializeSchema();
    const nodes = restartedManager.getNodesForActiveProfile();

    assert.deepEqual(nodes.map((entry) => entry.text_content), ['Active Resume node', 'Active JD node']);
    assert.deepEqual(nodes.map((entry) => entry.document_id), [activeResumeId, activeJdId]);
});
}
