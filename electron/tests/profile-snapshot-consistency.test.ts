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
    createProfilePairFingerprint,
} = require(path.join(process.cwd(), 'premium/electron/knowledge/NegotiationEngine.ts')) as typeof import('../../premium/electron/knowledge/NegotiationEngine');
const {
    DocType,
} = require(path.join(process.cwd(), 'premium/electron/knowledge/types.ts')) as typeof import('../../premium/electron/knowledge/types');

type KnowledgeDocument = import('../../premium/electron/knowledge/types').KnowledgeDocument;
type ProfileSnapshotValidationInput = import('../../premium/electron/knowledge/KnowledgeDatabaseManager').ProfileSnapshotValidationInput;

class SnapshotFakeStatement {
    private readonly db: SnapshotFakeDatabase;
    private readonly sql: string;

    constructor(db: SnapshotFakeDatabase, sql: string) {
        this.db = db;
        this.sql = sql;
    }

    run(...params: any[]) {
        return this.db.run(this.sql, params);
    }

    get(...params: any[]) {
        return this.db.get(this.sql, params);
    }
}

class SnapshotFakeDatabase {
    private readonly knowledgeMeta = new Map<string, string>();

    prepare(sql: string) {
        return new SnapshotFakeStatement(this, sql);
    }

    run(sql: string, params: any[]) {
        const normalized = snapshotSql(sql);
        if (normalized.startsWith('insert into knowledge_meta')) {
            const [key, value] = params;
            this.knowledgeMeta.set(key, value);
            return { changes: 1 };
        }
        if (normalized.startsWith('delete from knowledge_meta where key = ?')) {
            const [key] = params;
            const existed = this.knowledgeMeta.delete(key);
            return { changes: existed ? 1 : 0 };
        }
        return { changes: 0 };
    }

    get(sql: string, params: any[]) {
        const normalized = snapshotSql(sql);
        if (normalized.startsWith('select value from knowledge_meta')) {
            const [key] = params;
            const value = this.knowledgeMeta.get(key);
            return value === undefined ? undefined : { value };
        }
        return undefined;
    }
}

function snapshotSql(sql: string): string {
    return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

function snapshotManager(backingDb: SnapshotFakeDatabase = new SnapshotFakeDatabase()): any {
    return new KnowledgeDatabaseManager(backingDb as any);
}

function snapshotResume(id: number, name: string): KnowledgeDocument {
    return {
        id,
        type: DocType.RESUME,
        source_uri: `/tmp/resume-${id}.json`,
        structured_data: {
            identity: { name },
            skills: ['TypeScript'],
            experience: [],
            projects: [],
            education: [],
            achievements: [],
            certifications: [],
            leadership: [],
        },
        created_at: '2026-06-04 00:00:00',
    };
}

function snapshotJD(id: number, title: string): KnowledgeDocument {
    return {
        id,
        type: DocType.JD,
        source_uri: `/tmp/jd-${id}.json`,
        structured_data: {
            title,
            company: 'Amazon',
            location: 'Remote',
            description_summary: title,
            level: 'senior',
            employment_type: 'full_time',
            min_years_experience: 5,
            compensation_hint: '',
            requirements: ['TypeScript'],
            nice_to_haves: [],
            responsibilities: [],
            technologies: ['Node.js'],
            keywords: ['backend'],
        },
        created_at: '2026-06-04 00:00:00',
    };
}

function snapshotExpected(
    resumeDoc: KnowledgeDocument | null,
    jdDoc: KnowledgeDocument | null,
    generationId = 42,
    activeProfilePairId: number | null = null
): ProfileSnapshotValidationInput {
    return {
        activeResumeId: resumeDoc?.id ?? null,
        activeJDId: jdDoc?.id ?? null,
        activeProfilePairId,
        pairFingerprint: createProfilePairFingerprint(resumeDoc, jdDoc)?.pairFingerprint ?? null,
        generationId,
    };
}

function snapshotPayload(expected: ProfileSnapshotValidationInput, label: string) {
    return {
        snapshotMetadata: {
            ...expected,
            createdAt: '2026-06-04T00:00:00.000Z',
        },
        identity: { name: label },
        generationId: expected.generationId,
    };
}

test('Resume replacement rejects old snapshot metadata and accepts rebuilt active snapshot', () => {
    const manager = snapshotManager();
    const resumeA = snapshotResume(1, 'Resume A');
    const resumeB = snapshotResume(2, 'Resume B');
    const jdX = snapshotJD(10, 'JD X');
    const oldExpected = snapshotExpected(resumeA, jdX);
    const activeExpected = snapshotExpected(resumeB, jdX);

    manager.saveProfileSnapshot(snapshotPayload(oldExpected, 'old snapshot'));

    assert.equal(manager.getProfileSnapshot(activeExpected), null);

    manager.saveProfileSnapshot(snapshotPayload(activeExpected, 'new snapshot'));
    assert.equal(manager.getProfileSnapshot(activeExpected)?.identity?.name, 'new snapshot');
});

test('JD replacement rejects old snapshot metadata and accepts rebuilt active snapshot', () => {
    const manager = snapshotManager();
    const resumeA = snapshotResume(1, 'Resume A');
    const jdX = snapshotJD(10, 'JD X');
    const jdY = snapshotJD(11, 'JD Y');
    const oldExpected = snapshotExpected(resumeA, jdX);
    const activeExpected = snapshotExpected(resumeA, jdY);

    manager.saveProfileSnapshot(snapshotPayload(oldExpected, 'old jd snapshot'));

    assert.equal(manager.getProfileSnapshot(activeExpected), null);

    manager.saveProfileSnapshot(snapshotPayload(activeExpected, 'new jd snapshot'));
    assert.equal(manager.getProfileSnapshot(activeExpected)?.identity?.name, 'new jd snapshot');
});

test('Restart restores only snapshot matching active metadata', () => {
    const backingDb = new SnapshotFakeDatabase();
    const manager = snapshotManager(backingDb);
    const resumeActive = snapshotResume(7, 'Active Resume');
    const jdActive = snapshotJD(17, 'Active JD');
    const activeExpected = snapshotExpected(resumeActive, jdActive, 88, 123);

    manager.saveProfileSnapshot(snapshotPayload(activeExpected, 'active restart snapshot'));

    const restartedManager = snapshotManager(backingDb);
    assert.equal(restartedManager.getProfileSnapshot(activeExpected)?.identity?.name, 'active restart snapshot');
    assert.equal(restartedManager.getProfileSnapshot(snapshotExpected(snapshotResume(8, 'Other Resume'), jdActive, 88, 123)), null);
});

test('Legacy snapshot without metadata is rejected and rebuilt metadata validates', () => {
    const manager = snapshotManager();
    const resumeActive = snapshotResume(1, 'Active Resume');
    const jdActive = snapshotJD(10, 'Active JD');
    const expected = snapshotExpected(resumeActive, jdActive);

    manager.saveProfileSnapshot({ identity: { name: 'legacy snapshot' } });

    assert.equal(manager.getProfileSnapshot(expected), null);

    manager.saveProfileSnapshot(snapshotPayload(expected, 'rebuilt snapshot'));
    assert.equal(manager.getProfileSnapshot(expected)?.identity?.name, 'rebuilt snapshot');
});

test('Pair fingerprint mismatch rejects snapshot even when active ids match', () => {
    const manager = snapshotManager();
    const resumeActive = snapshotResume(1, 'Active Resume');
    const jdActive = snapshotJD(10, 'Active JD');
    const expected = snapshotExpected(resumeActive, jdActive);
    const mismatched = {
        ...expected,
        pairFingerprint: 'not-the-active-pair-fingerprint',
    };

    manager.saveProfileSnapshot(snapshotPayload(mismatched, 'bad pair snapshot'));

    assert.equal(manager.getProfileSnapshot(expected), null);
});
}
