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
    CompanyResearchEngine,
    jdContextFromStructured,
} = require(path.join(process.cwd(), 'premium/electron/knowledge/CompanyResearchEngine.ts')) as typeof import('../../premium/electron/knowledge/CompanyResearchEngine');
const {
    createProfilePairFingerprint,
} = require(path.join(process.cwd(), 'premium/electron/knowledge/NegotiationEngine.ts')) as typeof import('../../premium/electron/knowledge/NegotiationEngine');
const {
    TavilyService,
} = require(path.join(process.cwd(), 'premium/electron/research/TavilyService.ts')) as typeof import('../../premium/electron/research/TavilyService');
const {
    DocType,
} = require(path.join(process.cwd(), 'premium/electron/knowledge/types.ts')) as typeof import('../../premium/electron/knowledge/types');

type AOTInputIdentity = import('../../premium/electron/knowledge/KnowledgeDatabaseManager').AOTInputIdentity;
type KnowledgeDocument = import('../../premium/electron/knowledge/types').KnowledgeDocument;
type StructuredJD = import('../../premium/electron/knowledge/types').StructuredJD;

class DossierFakeStatement {
    private readonly db: DossierFakeDatabase;
    private readonly sql: string;

    constructor(db: DossierFakeDatabase, sql: string) {
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

class DossierFakeDatabase {
    private nextDossierId = 1;
    private readonly knowledgeMeta = new Map<string, string>();
    private companyDossiers: any[];
    private migratedCompanyDossiers: any[] = [];
    private legacyDossierSchema: boolean;
    private activeState: any = {
        id: 1,
        active_resume_id: null,
        active_jd_id: null,
        active_profile_pair_id: null,
        generation_id: 0,
        active_generation_token: null,
        updated_at: '2026-01-01 00:00:00',
    };

    constructor(legacyRows: any[] = []) {
        this.legacyDossierSchema = legacyRows.length > 0;
        this.companyDossiers = legacyRows.map((row, index) => ({
            id: row.id ?? index + 1,
            company_name: row.company_name,
            last_checked: row.last_checked ?? '2026-01-01 00:00:00',
            dossier_json: row.dossier_json,
            source_trace: row.source_trace ?? '[]',
            ttl_hours: row.ttl_hours ?? 24,
        }));
        this.nextDossierId = this.companyDossiers.length + 1;
    }

    prepare(sql: string) {
        return new DossierFakeStatement(this, sql);
    }

    exec(sql: string) {
        const normalized = dossierNormalizeSql(sql);
        if (normalized.includes('drop table company_dossiers;') && normalized.includes('alter table company_dossiers_migrated rename to company_dossiers')) {
            this.companyDossiers = this.migratedCompanyDossiers;
            this.migratedCompanyDossiers = [];
            this.legacyDossierSchema = false;
            this.nextDossierId = this.companyDossiers.reduce((max, row) => Math.max(max, row.id || 0), 0) + 1;
        }
        return this;
    }

    transaction<T extends (...args: any[]) => any>(fn: T): T {
        return ((...args: any[]) => fn(...args)) as T;
    }

    close() {}

    run(sql: string, params: any[]) {
        const normalized = dossierNormalizeSql(sql);

        if (normalized.startsWith('insert into company_dossiers_migrated')) {
            const [
                id,
                companyName,
                scope,
                pairFingerprint,
                resumeFingerprint,
                jdFingerprint,
                lastChecked,
                dossierJson,
                sourceTrace,
                ttlHours,
            ] = params;
            this.migratedCompanyDossiers.push({
                id,
                company_name: companyName,
                dossier_scope: scope,
                pair_fingerprint: pairFingerprint,
                resume_fingerprint: resumeFingerprint,
                jd_fingerprint: jdFingerprint,
                last_checked: lastChecked,
                dossier_json: dossierJson,
                source_trace: sourceTrace,
                ttl_hours: ttlHours,
            });
            return { changes: 1 };
        }

        if (normalized.startsWith('insert into company_dossiers')) {
            const [
                companyName,
                scope,
                pairFingerprint,
                resumeFingerprint,
                jdFingerprint,
                dossierJson,
                sourceTrace,
            ] = params;
            const existing = this.companyDossiers.find((row) =>
                row.company_name === companyName
                && row.dossier_scope === scope
                && row.pair_fingerprint === pairFingerprint
            );
            if (existing) {
                Object.assign(existing, {
                    resume_fingerprint: resumeFingerprint,
                    jd_fingerprint: jdFingerprint,
                    last_checked: '2026-01-01 00:10:00',
                    dossier_json: dossierJson,
                    source_trace: sourceTrace,
                });
                return { changes: 1 };
            }
            const id = this.nextDossierId++;
            this.companyDossiers.push({
                id,
                company_name: companyName,
                dossier_scope: scope,
                pair_fingerprint: pairFingerprint,
                resume_fingerprint: resumeFingerprint,
                jd_fingerprint: jdFingerprint,
                last_checked: '2026-01-01 00:10:00',
                dossier_json: dossierJson,
                source_trace: sourceTrace,
                ttl_hours: 24,
            });
            return { lastInsertRowid: id, changes: 1 };
        }

        if (normalized.startsWith('update company_dossiers set dossier_json = ? where id = ?')) {
            const [dossierJson, id] = params;
            const row = this.companyDossiers.find((entry) => entry.id === id);
            if (!row) return { changes: 0 };
            row.dossier_json = dossierJson;
            return { changes: 1 };
        }

        if (normalized.startsWith('insert into knowledge_meta')) {
            const [key, value] = params;
            this.knowledgeMeta.set(key, value);
            return { changes: 1 };
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
                updated_at: '2026-01-01 00:20:00',
            };
            return { changes: 1 };
        }

        if (normalized.startsWith('delete from company_dossiers where company_name = ?')) {
            const [companyName] = params;
            const before = this.companyDossiers.length;
            this.companyDossiers = this.companyDossiers.filter((row) => row.company_name !== companyName);
            return { changes: before - this.companyDossiers.length };
        }

        if (normalized.startsWith('delete from company_dossiers')) {
            const changes = this.companyDossiers.length;
            this.companyDossiers = [];
            return { changes };
        }

        return { changes: 0 };
    }

    get(sql: string, params: any[]) {
        const normalized = dossierNormalizeSql(sql);

        if (normalized.startsWith('select * from company_dossiers where company_name = ? and dossier_scope = ? and pair_fingerprint = ?')) {
            const [companyName, scope, pairFingerprint] = params;
            return this.companyDossiers.find((row) =>
                row.company_name === companyName
                && row.dossier_scope === scope
                && row.pair_fingerprint === pairFingerprint
            );
        }

        if (normalized.startsWith('select value from knowledge_meta')) {
            const [key] = params;
            const value = this.knowledgeMeta.get(key);
            return value === undefined ? undefined : { value };
        }

        if (normalized.startsWith('select id from profile_active_state')) {
            return { id: 1 };
        }

        if (normalized.startsWith('select active_resume_id')) {
            return this.activeState;
        }

        return undefined;
    }

    all(sql: string, params: any[] = []) {
        const normalized = dossierNormalizeSql(sql);

        if (normalized.startsWith('pragma table_info(company_dossiers)')) {
            return this.legacyDossierSchema
                ? [
                    { name: 'id' },
                    { name: 'company_name' },
                    { name: 'last_checked' },
                    { name: 'dossier_json' },
                    { name: 'source_trace' },
                    { name: 'ttl_hours' },
                ]
                : this.companyDossierColumns();
        }

        if (normalized.startsWith('pragma table_info(profile_active_state)')) {
            return [
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
            return this.legacyDossierSchema
                ? [{ name: 'sqlite_autoindex_company_dossiers_1', unique: 1 }]
                : [];
        }

        if (normalized.startsWith('pragma index_info(sqlite_autoindex_company_dossiers_1)')) {
            return [{ name: 'company_name' }];
        }

        if (normalized.startsWith('select * from company_dossiers where company_name = ?')) {
            const [companyName] = params;
            return this.companyDossiers
                .filter((row) => row.company_name === companyName)
                .sort((a, b) => `${a.dossier_scope}:${a.pair_fingerprint}`.localeCompare(`${b.dossier_scope}:${b.pair_fingerprint}`));
        }

        if (normalized.startsWith('select * from company_dossiers order by')) {
            return [...this.companyDossiers];
        }

        if (normalized.startsWith('select id, dossier_json from company_dossiers where dossier_scope = ?')) {
            const [scope] = params;
            return this.companyDossiers
                .filter((row) => row.dossier_scope === scope)
                .map((row) => ({ id: row.id, dossier_json: row.dossier_json }));
        }

        if (normalized.startsWith('select * from company_dossiers')) {
            return [...this.companyDossiers];
        }

        return [];
    }

    private companyDossierColumns() {
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
}

function dossierNormalizeSql(sql: string): string {
    return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

function dossierDb(legacyRows: any[] = []) {
    const db = new DossierFakeDatabase(legacyRows);
    const manager = new KnowledgeDatabaseManager(db as any);
    manager.initializeSchema();
    return { db, manager };
}

function dossierResume(id: number, name: string): KnowledgeDocument {
    return {
        id,
        type: DocType.RESUME,
        source_uri: `${name}.pdf`,
        structured_data: {
            identity: { name },
            skills: ['TypeScript', 'Node.js'],
            experience: [],
            projects: [],
            education: [],
            achievements: [],
            certifications: [],
            leadership: [],
        },
    };
}

function dossierJD(id: number, title: string, company = 'Acme'): KnowledgeDocument {
    const structured: StructuredJD = {
        title,
        company,
        location: 'Remote',
        description_summary: `${title} role at ${company}`,
        level: 'mid',
        employment_type: 'full_time',
        min_years_experience: 3,
        compensation_hint: '',
        requirements: [`${title} requirement`],
        nice_to_haves: [],
        responsibilities: [`Own ${title} delivery`],
        technologies: title.toLowerCase().includes('frontend') ? ['React'] : ['Node.js'],
        keywords: [title],
    };
    return {
        id,
        type: DocType.JD,
        source_uri: `${title}.txt`,
        structured_data: structured,
    };
}

function dossierPayload(roleLabel: string, company = 'Acme') {
    return {
        company,
        hiring_strategy: `${roleLabel} hiring strategy`,
        interview_focus: `${roleLabel} interview focus`,
        interview_difficulty: 'hard',
        core_values: ['Ownership', 'Customer Focus'],
        salary_estimates: [{
            title: roleLabel,
            location: 'Remote',
            min: 120000,
            max: 160000,
            currency: 'USD',
            source: `${roleLabel} source`,
            confidence: 'medium',
        }],
        culture_ratings: {
            overall: 4.1,
            work_life_balance: 3.8,
            career_growth: 4,
            compensation: 3.9,
            management: 3.7,
            diversity: 4.2,
            review_count: '100 reviews',
            data_sources: ['Glassdoor'],
        },
        employee_reviews: [{
            quote: 'Strong engineering culture',
            sentiment: 'positive',
            source: 'Glassdoor',
            role: 'Engineer',
        }],
        critics: [{
            category: 'Pace',
            complaint: 'Fast-moving teams',
            frequency: 'occasionally',
        }],
        benefits: ['Health insurance'],
        competitors: ['Contoso'],
        recent_news: 'Acme expanded its platform.',
        sources: [`https://example.com/${roleLabel.replace(/\s+/g, '-').toLowerCase()}`],
        fetched_at: new Date('2026-01-01T00:00:00Z').toISOString(),
    };
}

function dossierPair(resume: KnowledgeDocument, jd: KnowledgeDocument): AOTInputIdentity {
    const identity = createProfilePairFingerprint(resume, jd);
    assert.ok(identity, 'pair fingerprint should exist');
    return identity;
}

test('Same company different JD reuses company facts but regenerates profile-aware insights', async () => {
    const { db, manager } = dossierDb();
    try {
        const resume = dossierResume(1, 'Resume A');
        const jdA = dossierJD(10, 'Backend Engineer');
        const jdB = dossierJD(11, 'Frontend Engineer');
        const pairA = dossierPair(resume, jdA);
        const pairB = dossierPair(resume, jdB);
        const research = new CompanyResearchEngine(manager);
        const service = new TavilyService(research);
        let generationCalls = 0;

        research.setGenerateContentFn(async (contents: any[]) => {
            generationCalls++;
            const prompt = String(contents[0]?.text || '');
            return JSON.stringify(dossierPayload(prompt.includes('Frontend Engineer') ? 'Frontend Engineer' : 'Backend Engineer'));
        });

        const insightsA = await service.fetchCompanyInsights('Acme', 'Backend Engineer', jdContextFromStructured(jdA.structured_data), {
            inputIdentity: pairA,
        });
        assert.equal(generationCalls, 1);
        assert.match(insightsA?.interviewFocus || '', /Backend Engineer/);

        assert.equal(service.getCachedInsights('Acme', 'Frontend Engineer', jdContextFromStructured(jdB.structured_data), pairB), null);

        const insightsB = await service.fetchCompanyInsights('Acme', 'Frontend Engineer', jdContextFromStructured(jdB.structured_data), {
            inputIdentity: pairB,
        });
        assert.equal(generationCalls, 2);
        assert.match(insightsB?.interviewFocus || '', /Frontend Engineer/);

        const facts = manager.getCompanyFactsDossier('Acme');
        assert.ok(facts, 'company facts row should exist');
        assert.equal(facts.dossier.hiring_strategy, '');
        assert.equal(facts.dossier.interview_focus, '');
        assert.deepEqual(facts.dossier.salary_estimates, []);

        const rows = manager.getCompanyDossierRows('Acme');
        assert.equal(rows.filter((row: any) => row.scope === 'company_facts').length, 1);
        assert.equal(rows.filter((row: any) => row.scope === 'profile_insights').length, 2);
        assert.match(manager.getDossier('Acme', pairA)?.dossier.interview_focus || '', /Backend Engineer/);
        assert.match(manager.getDossier('Acme', pairB)?.dossier.interview_focus || '', /Frontend Engineer/);
    } finally {
        db.close();
    }
});

test('Resume change with same JD rejects old profile-aware dossier until regenerated', () => {
    const { db, manager } = dossierDb();
    try {
        const resumeA = dossierResume(1, 'Resume A');
        const resumeB = dossierResume(2, 'Resume B');
        const jd = dossierJD(10, 'Backend Engineer');
        const pairA = dossierPair(resumeA, jd);
        const pairB = dossierPair(resumeB, jd);

        manager.saveDossier('Acme', dossierPayload('Resume A fit'), [], pairA);

        assert.match(manager.getDossier('Acme', pairA)?.dossier.interview_focus || '', /Resume A fit/);
        assert.equal(manager.getDossier('Acme', pairB), null);
        assert.ok(manager.getCompanyFactsDossier('Acme'), 'company facts remain reusable after resume change');

        manager.saveDossier('Acme', dossierPayload('Resume B fit'), [], pairB);

        assert.match(manager.getDossier('Acme', pairB)?.dossier.interview_focus || '', /Resume B fit/);
        assert.equal(manager.getCompanyDossierRows('Acme').filter((row: any) => row.scope === 'profile_insights').length, 2);
    } finally {
        db.close();
    }
});

test('Restart restore loads only matching profile-aware dossier into AOT cache', () => {
    const { db, manager } = dossierDb();
    try {
        const resume = dossierResume(1, 'Resume A');
        const jdA = dossierJD(10, 'Backend Engineer');
        const jdB = dossierJD(11, 'Frontend Engineer');
        const pairA = dossierPair(resume, jdA);
        const pairB = dossierPair(resume, jdB);

        manager.saveDossier('Acme', dossierPayload('Backend Engineer'), [], pairA);
        manager.saveDossier('Acme', dossierPayload('Frontend Engineer'), [], pairB);

        const restartedManager = new KnowledgeDatabaseManager(db as any);
        restartedManager.initializeSchema();
        const restartedResearch = new CompanyResearchEngine(restartedManager);
        const pipeline = new AOTPipeline(restartedManager, restartedResearch);
        const restore = pipeline.initializeFromStoredData(jdB, resume);

        assert.equal(restore.restoredOutputs.dossier, true);
        assert.match(pipeline.getCachedDossier(pairB)?.interview_focus || '', /Frontend Engineer/);
        assert.equal(pipeline.getCachedDossier(pairA), null);
    } finally {
        db.close();
    }
});

test('Legacy company-only dossier migrates to facts and is not trusted as profile-aware insight', () => {
    const { db, manager } = dossierDb([{
        id: 1,
        company_name: 'acme',
        last_checked: '2026-01-01 00:00:00',
        dossier_json: JSON.stringify(dossierPayload('Legacy backend role')),
        source_trace: JSON.stringify(['legacy']),
        ttl_hours: 24,
    }]);
    try {
        const resume = dossierResume(1, 'Resume A');
        const jd = dossierJD(10, 'Backend Engineer');
        const pair = dossierPair(resume, jd);
        const facts = manager.getCompanyFactsDossier('Acme');

        assert.ok(facts, 'legacy row should survive as company facts');
        assert.equal(facts.dossier.hiring_strategy, '');
        assert.equal(facts.dossier.interview_focus, '');
        assert.deepEqual(facts.dossier.salary_estimates, []);
        assert.equal(manager.getDossier('Acme', pair), null);

        manager.saveDossier('Acme', dossierPayload('Fresh pair role'), [], pair);
        assert.match(manager.getDossier('Acme', pair)?.dossier.interview_focus || '', /Fresh pair role/);
    } finally {
        db.close();
    }
});
}
