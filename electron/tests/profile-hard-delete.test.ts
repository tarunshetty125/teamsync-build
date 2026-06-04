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

type DocTypeValue = import('../../premium/electron/knowledge/types').DocType;

class HardDeleteStatement {
    private readonly db: HardDeleteDatabase;
    private readonly sql: string;

    constructor(db: HardDeleteDatabase, sql: string) {
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

class HardDeleteDatabase {
    private nextDocumentId = 1;
    private nextNodeId = 1;
    readonly execLog: string[] = [];
    readonly documents: any[] = [];
    readonly contextNodes: any[] = [];
    readonly aotResults: any[] = [];
    readonly companyDossiers: any[] = [];
    readonly knowledgeMeta = new Map<string, string>();
    readonly profileCustomNotes: any[] = [];
    readonly resumeNodes: any[] = [];
    readonly userProfileRows: any[] = [];
    activeState: any | null = null;

    prepare(sql: string) {
        return new HardDeleteStatement(this, sql);
    }

    exec(sql: string) {
        const normalized = normalizeHardDeleteSql(sql);
        this.execLog.push(normalized);
        if (normalized.includes('delete from resume_nodes')) {
            this.resumeNodes.length = 0;
        }
        if (normalized.includes('delete from user_profile')) {
            this.userProfileRows.length = 0;
        }
        return this;
    }

    transaction<T extends (...args: any[]) => any>(fn: T): T {
        return ((...args: any[]) => fn(...args)) as T;
    }

    seedProfileArtifacts(): void {
        const resumeActiveId = this.insertDocument(DocType.RESUME, { identity: { name: 'Resume A' } }, 'active');
        const jdActiveId = this.insertDocument(DocType.JD, { title: 'JD A', company: 'Acme' }, 'active');
        this.insertDocument(DocType.RESUME, { identity: { name: 'Resume B' } }, 'staged');
        this.insertDocument(DocType.JD, { title: 'JD B', company: 'Acme' }, 'superseded');
        this.insertDocument(DocType.RESUME, { identity: { name: 'Resume C' } }, 'failed');
        this.contextNodes.push(
            { id: this.nextNodeId++, document_id: resumeActiveId, source_type: DocType.RESUME, category: 'experience', title: 'Resume node', text_content: 'secret resume text', tags: '[]', embedding: Buffer.from([1, 2, 3, 4]) },
            { id: this.nextNodeId++, document_id: jdActiveId, source_type: DocType.JD, category: 'requirement', title: 'JD node', text_content: 'secret jd text', tags: '[]', embedding: Buffer.from([5, 6, 7, 8]) },
        );
        this.aotResults.push({ id: 1, document_id: jdActiveId, result_type: 'culture_mappings', result_json: '{"secret":true}' });
        this.companyDossiers.push({ id: 1, company_name: 'acme', dossier_scope: 'profile_insights', pair_fingerprint: 'pair-secret', dossier_json: '{"role":"secret"}' });
        this.knowledgeMeta.set('active_profile_snapshot', '{"snapshotMetadata":{"pairFingerprint":"pair-secret"}}');
        this.knowledgeMeta.set('current_generation_id', '99');
        this.profileCustomNotes.push({ id: 1, content: 'secret note', generation_id: 99 });
        this.resumeNodes.push({ id: 1, text_content: 'legacy resume secret' });
        this.userProfileRows.push({ id: 1, structured_json: '{"secret":true}' });
        this.activeState = {
            id: 1,
            active_resume_id: resumeActiveId,
            active_jd_id: jdActiveId,
            active_profile_pair_id: 123,
            generation_id: 99,
            active_generation_token: 'secret-generation-token',
            updated_at: '2026-01-01 00:00:00',
        };
    }

    run(sql: string, params: any[]) {
        const normalized = normalizeHardDeleteSql(sql);

        if (normalized.startsWith('insert into knowledge_documents')) {
            const id = this.nextDocumentId++;
            if (params.length >= 5) {
                const [type, sourceUri, structuredData, lifecycleState, lifecycleGenerationId] = params;
                this.documents.push({
                    id,
                    type,
                    source_uri: sourceUri,
                    structured_data: structuredData,
                    lifecycle_state: lifecycleState,
                    lifecycle_generation_id: lifecycleGenerationId,
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
                created_at: `2026-01-01 00:00:${String(id).padStart(2, '0')}`,
            });
            return { lastInsertRowid: id, changes: 1 };
        }

        if (normalized.startsWith('insert into context_nodes')) {
            const [documentId, sourceType, category, title, organization, startDate, endDate, durationMonths, textContent, tags, embedding] = params;
            this.contextNodes.push({
                id: this.nextNodeId++,
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
            return { lastInsertRowid: this.nextNodeId - 1, changes: 1 };
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
            this.knowledgeMeta.set(params[0], params[1]);
            return { changes: 1 };
        }

        if (normalized.startsWith('delete from context_nodes')) {
            const changes = this.contextNodes.length;
            this.contextNodes.length = 0;
            return { changes };
        }
        if (normalized.startsWith('delete from aot_results')) {
            const changes = this.aotResults.length;
            this.aotResults.length = 0;
            return { changes };
        }
        if (normalized.startsWith('delete from company_dossiers')) {
            const changes = this.companyDossiers.length;
            this.companyDossiers.length = 0;
            return { changes };
        }
        if (normalized.startsWith('delete from knowledge_meta')) {
            const changes = this.knowledgeMeta.size;
            this.knowledgeMeta.clear();
            return { changes };
        }
        if (normalized.startsWith('delete from profile_custom_notes')) {
            const changes = this.profileCustomNotes.length;
            this.profileCustomNotes.length = 0;
            return { changes };
        }
        if (normalized.startsWith('delete from knowledge_documents')) {
            const changes = this.documents.length;
            this.documents.length = 0;
            return { changes };
        }
        if (normalized.startsWith('delete from profile_active_state')) {
            const changes = this.activeState ? 1 : 0;
            this.activeState = null;
            return { changes };
        }

        if (
            normalized.startsWith('update knowledge_documents set lifecycle_state = ?, lifecycle_updated_at = datetime')
            && normalized.includes('where type = ?')
        ) {
            return { changes: 0 };
        }
        if (
            normalized.startsWith('update knowledge_documents set lifecycle_state = ?')
            && normalized.includes('where id = ?')
        ) {
            return { changes: 0 };
        }

        return { changes: 0 };
    }

    get(sql: string, params: any[]) {
        const normalized = normalizeHardDeleteSql(sql);

        if (normalized.startsWith('select id from profile_active_state')) {
            return this.activeState ? { id: 1 } : undefined;
        }

        if (normalized.startsWith('select active_resume_id')) {
            return this.activeState ?? undefined;
        }

        if (normalized.startsWith('select value from knowledge_meta')) {
            const value = this.knowledgeMeta.get(params[0]);
            return value === undefined ? undefined : { value };
        }

        if (normalized.startsWith('select * from knowledge_documents where id = ?')) {
            return this.documents.find((document) => document.id === params[0]);
        }

        if (normalized.startsWith('select id, type, lifecycle_state from knowledge_documents')) {
            const [id, type, lifecycleState] = params;
            return this.documents.find((document) =>
                document.id === id
                && document.type === type
                && document.lifecycle_state === lifecycleState
            );
        }

        if (normalized.startsWith('select * from knowledge_documents where type = ?')) {
            const [type, lifecycleState] = params;
            return [...this.documents]
                .filter((document) =>
                    document.type === type
                    && (!normalized.includes('lifecycle_state') || document.lifecycle_state === lifecycleState)
                )
                .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id)[0];
        }

        if (normalized.startsWith('select count(*) as count from')) {
            return { count: this.countForQuery(normalized, params) };
        }

        return undefined;
    }

    all(sql: string, params: any[] = []) {
        const normalized = normalizeHardDeleteSql(sql);

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

        if (normalized.startsWith('pragma table_info(profile_custom_notes)')) {
            return [
                { name: 'id' },
                { name: 'content' },
                { name: 'updated_at' },
                { name: 'generation_id' },
            ];
        }

        if (normalized.startsWith('pragma table_info(company_dossiers)')) {
            return [
                { name: 'id' },
                { name: 'company_name' },
                { name: 'dossier_scope' },
                { name: 'pair_fingerprint' },
                { name: 'resume_fingerprint' },
                { name: 'jd_fingerprint' },
                { name: 'last_checked' },
                { name: 'dossier_json' },
                { name: 'source_trace' },
                { name: 'ttl_hours' },
            ];
        }

        if (normalized.startsWith('pragma index_list(company_dossiers)')) {
            return [{ name: 'sqlite_autoindex_company_dossiers_1', unique: 1 }];
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
                { name: 'pair_fingerprint' },
                { name: 'resume_fingerprint' },
                { name: 'jd_fingerprint' },
                { name: 'created_at' },
                { name: 'updated_at' },
                { name: 'version' },
            ];
        }

        if (normalized.startsWith('select id, dossier_json from company_dossiers')) {
            return [];
        }

        if (normalized.startsWith('select distinct result_type from aot_results')) {
            return [];
        }

        if (normalized.startsWith('select * from context_nodes where document_id in')) {
            const activeIds = new Set(params);
            return this.contextNodes.filter((node) => activeIds.has(node.document_id));
        }

        if (normalized.startsWith('select * from context_nodes order by id asc')) {
            return [...this.contextNodes].sort((a, b) => a.id - b.id);
        }

        return [];
    }

    private insertDocument(type: DocTypeValue, structuredData: any, lifecycleState: string): number {
        const id = this.nextDocumentId++;
        this.documents.push({
            id,
            type,
            source_uri: `/tmp/${type}-${id}.txt`,
            structured_data: JSON.stringify(structuredData),
            lifecycle_state: lifecycleState,
            lifecycle_generation_id: lifecycleState === 'staged' ? 99 : null,
            created_at: `2026-01-01 00:00:${String(id).padStart(2, '0')}`,
        });
        return id;
    }

    private countForQuery(normalized: string, params: any[]): number {
        if (normalized.includes('from knowledge_documents')) return this.documents.length;
        if (normalized.includes('from context_nodes')) return this.contextNodes.length;
        if (normalized.includes('from aot_results')) return this.aotResults.length;
        if (normalized.includes('from company_dossiers')) return this.companyDossiers.length;
        if (normalized.includes('from knowledge_meta')) {
            if (normalized.includes('where key = ?')) {
                return this.knowledgeMeta.has(params[0]) ? 1 : 0;
            }
            return this.knowledgeMeta.size;
        }
        if (normalized.includes('from profile_custom_notes')) return this.profileCustomNotes.length;
        if (normalized.includes('from profile_active_state')) {
            if (!this.activeState) return 0;
            return this.activeState.active_resume_id !== null
                || this.activeState.active_jd_id !== null
                || this.activeState.active_profile_pair_id !== null
                || Number(this.activeState.generation_id || 0) !== 0
                || this.activeState.active_generation_token !== null
                ? 1
                : 0;
        }
        if (normalized.includes('from resume_nodes')) return this.resumeNodes.length;
        if (normalized.includes('from user_profile')) return this.userProfileRows.length;
        return 0;
    }
}

function normalizeHardDeleteSql(sql: string): string {
    return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

function readSource(relativePath: string): string {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('Hard delete removes resume, JD, embeddings, AOT, dossiers, snapshot, notes, active state, and legacy artifacts', () => {
    const db = new HardDeleteDatabase();
    db.seedProfileArtifacts();
    const manager = new KnowledgeDatabaseManager(db as any);

    manager.hardDeleteProfileIntelligenceData();

    assert.deepEqual(manager.getProfileArtifactCounts(), {
        knowledgeDocuments: 0,
        contextNodes: 0,
        aotResults: 0,
        companyDossiers: 0,
        knowledgeMeta: 0,
        profileSnapshots: 0,
        profileCustomNotes: 0,
        profileActiveStateReferences: 0,
        resumeNodes: 0,
        userProfileRows: 0,
    });
    assert.equal(db.execLog.some((entry) => entry.includes('pragma secure_delete = on')), true);
    assert.equal(db.execLog.some((entry) => entry.includes('pragma wal_checkpoint(truncate)')), true);
    assert.equal(db.execLog.some((entry) => entry === 'vacuum;'), true);
});

test('Restart after hard delete restores fresh-install profile state', () => {
    const db = new HardDeleteDatabase();
    db.seedProfileArtifacts();
    const manager = new KnowledgeDatabaseManager(db as any);
    manager.hardDeleteProfileIntelligenceData();

    const restartedManager = new KnowledgeDatabaseManager(db as any);
    restartedManager.initializeSchema();

    assert.equal(restartedManager.getActiveResume(), null);
    assert.equal(restartedManager.getActiveJD(), null);
    assert.deepEqual(restartedManager.getNodesForActiveProfile(), []);
    assert.equal(restartedManager.getProfileSnapshot(), null);
    assert.equal(restartedManager.getActiveProfileState().activeResumeId, null);
    assert.equal(restartedManager.getActiveProfileState().activeJDId, null);
    assert.equal(restartedManager.getActiveProfileState().activeProfilePairId, null);
    assert.equal(restartedManager.getActiveProfileState().activeGenerationToken, null);
});

test('Hard delete blocks promotion of staged generation artifacts', () => {
    const db = new HardDeleteDatabase();
    const manager = new KnowledgeDatabaseManager(db as any);
    manager.initializeSchema();
    const generationId = 77;
    const resumeAId = manager.saveDocument({
        type: DocType.RESUME,
        source_uri: '/tmp/resume-a.txt',
        structured_data: { identity: { name: 'Resume A' } },
    });
    manager.setCurrentGenerationId(generationId);
    manager.setActiveProfileState({ activeResumeId: resumeAId });
    const stagedResumeId = manager.saveStagedDocument({
        type: DocType.RESUME,
        source_uri: '/tmp/resume-b.txt',
        structured_data: { identity: { name: 'Resume B' } },
    }, generationId);

    manager.hardDeleteProfileIntelligenceData();

    assert.equal(manager.promoteStagedDocument(DocType.RESUME, stagedResumeId, generationId), false);
    assert.equal(manager.getDocumentById(stagedResumeId), null);
    assert.equal(manager.getActiveResume(), null);
});

test('Lifecycle hard-delete wiring covers explicit delete, trial expiry, license loss, logout, and account switch', () => {
    const ipcHandlers = readSource('electron/ipcHandlers.ts');
    const main = readSource('electron/main.ts');
    const googleAuthManager = readSource('electron/services/GoogleAuthManager.ts');
    const preload = readSource('electron/preload.ts');

    assert.match(ipcHandlers, /safeHandle\("profile:hard-delete-all"/);
    assert.match(ipcHandlers, /hardDeleteProfileIntelligence\('trial-expiry'\)/);
    assert.match(ipcHandlers, /hardDeleteProfileIntelligence\('license-deactivate'\)/);
    assert.match(main, /hardDeleteProfileIntelligence\('entitlement-loss'\)/);
    assert.match(main, /setProfileLifecycleCleanup/);
    assert.match(googleAuthManager, /runProfileLifecycleCleanup\('logout'\)/);
    assert.match(googleAuthManager, /runProfileLifecycleCleanup\('account-switch'\)/);
    assert.match(preload, /profileHardDeleteAll: \(reason\?: string\) => ipcRenderer\.invoke\('profile:hard-delete-all', reason\)/);
});

test('Hard-delete helper clears settings, renderer state, orchestrator caches, and ActionResponseCache hooks', () => {
    const main = readSource('electron/main.ts');
    const orchestrator = readSource('premium/electron/knowledge/KnowledgeOrchestrator.ts');
    const settingsManager = readSource('electron/services/SettingsManager.ts');
    const intelligenceManager = readSource('electron/IntelligenceManager.ts');

    assert.match(settingsManager, /clearProfileSettings\(\)/);
    assert.match(main, /clearProfileSettings\(\)/);
    assert.match(main, /clearCustomNotes\(\)/);
    assert.match(main, /clearActionResponseCache\?\.\(\)/);
    assert.match(main, /broadcast\('profile-updated', null\)/);
    assert.match(orchestrator, /tavilyService\.clearCache\(\{ dropInFlight: true \}\)/);
    assert.match(orchestrator, /this\.aotPipeline\.reset\(\)/);
    assert.match(orchestrator, /this\.salaryEngine\.clearCache\(\)/);
    assert.match(orchestrator, /this\.cachedNodes = \[\]/);
    assert.match(intelligenceManager, /clearActionResponseCache\(\): void/);
});
}
