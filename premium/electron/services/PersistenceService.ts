import { app } from 'electron';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { AOTStatus, CompanyDossier, ContextNode, KnowledgeDocument } from '../knowledge/types';
import { LicenseService } from './LicenseService';

export interface PersistedResumeSnapshot {
    version: string;
    updatedAt: string;
    data: {
        resume?: KnowledgeDocument;
        jd?: KnowledgeDocument;
        resumeNodes?: ContextNode[];
        jdNodes?: ContextNode[];
        knowledgeModeActive?: boolean;
    };
}

export interface PersistedAotSnapshot {
    version: string;
    updatedAt: string;
    status: AOTStatus;
    progress: number;
    gapAnalysis?: any;
    negotiationScript?: any;
    cultureMappings?: any;
    mockQuestions?: any;
    companyDossier?: CompanyDossier | null;
}

const CACHE_VERSION = 'v3';
const WRITE_DEBOUNCE_MS = 300;

export class PersistenceService {
    private static instance: PersistenceService;

    private readonly licenseService: LicenseService;
    private readonly rootDir: string;
    private readonly resumesDir: string;
    private readonly aotDir: string;
    private readonly resumeMetadataPath: string;
    private readonly aotStatePath: string;
    private readonly legacyKnowledgeCachePath: string;
    private readonly dashboardPath: string;

    // In-memory cache for fast access during runtime
    private inMemoryDashboardCache: any | null = null;

    private pendingResumeSnapshot: PersistedResumeSnapshot | null = null;
    private pendingAotSnapshot: PersistedAotSnapshot | null = null;
    private resumeWriteTimer: NodeJS.Timeout | null = null;
    private aotWriteTimer: NodeJS.Timeout | null = null;
    private writeQueue: Promise<void> = Promise.resolve();
    private writeGeneration = 0;
    private writesEnabled = false;

    private constructor() {
        this.licenseService = LicenseService.getInstance();
        this.rootDir = path.join(app.getPath('appData'), 'pro_cache');
        this.resumesDir = path.join(this.rootDir, 'resumes');
        this.aotDir = path.join(this.rootDir, 'aot');
        this.resumeMetadataPath = path.join(this.resumesDir, 'metadata.json');
        this.aotStatePath = path.join(this.aotDir, 'state.json');
        this.legacyKnowledgeCachePath = path.join(app.getPath('userData'), 'knowledge_cache.json');
        this.dashboardPath = path.join(this.rootDir, 'dashboard.json');
    }

    public static getInstance(): PersistenceService {
        if (!PersistenceService.instance) {
            PersistenceService.instance = new PersistenceService();
        }
        return PersistenceService.instance;
    }

    public setWritesEnabled(enabled: boolean): void {
        this.writesEnabled = enabled;
        if (!enabled) {
            if (this.resumeWriteTimer) {
                clearTimeout(this.resumeWriteTimer);
                this.resumeWriteTimer = null;
            }
            if (this.aotWriteTimer) {
                clearTimeout(this.aotWriteTimer);
                this.aotWriteTimer = null;
            }
            this.pendingResumeSnapshot = null;
            this.pendingAotSnapshot = null;
        }
    }

    public queueResumeSnapshot(snapshot: PersistedResumeSnapshot): void {
        if (!this.licenseService.isProActive() || !this.writesEnabled) return;

        this.pendingResumeSnapshot = snapshot;
        if (this.resumeWriteTimer) {
            clearTimeout(this.resumeWriteTimer);
        }

        this.resumeWriteTimer = setTimeout(() => {
            this.resumeWriteTimer = null;
            void this.flushResumeSnapshot();
        }, WRITE_DEBOUNCE_MS);
    }

    public queueAotSnapshot(snapshot: PersistedAotSnapshot): void {
        if (!this.licenseService.isProActive() || !this.writesEnabled) return;

        this.pendingAotSnapshot = snapshot;
        if (this.aotWriteTimer) {
            clearTimeout(this.aotWriteTimer);
        }

        this.aotWriteTimer = setTimeout(() => {
            this.aotWriteTimer = null;
            void this.flushAotSnapshot();
        }, WRITE_DEBOUNCE_MS);
    }

    public loadResumeSnapshot(): PersistedResumeSnapshot | null {
        if (!this.licenseService.isProActive()) return null;

        try {
            if (!fs.existsSync(this.resumeMetadataPath)) return null;
            const raw = fs.readFileSync(this.resumeMetadataPath, 'utf-8');
            const parsed = JSON.parse(raw) as PersistedResumeSnapshot;
            if (!parsed || parsed.version !== CACHE_VERSION || !parsed.data) {
                throw new Error('Invalid resume snapshot schema');
            }
            return parsed;
        } catch (err: any) {
            console.warn('[PersistenceService] Resume cache corrupted, clearing:', err?.message || err);
            this.clearAllPersistedData(true);
            return null;
        }
    }

    public loadAotSnapshot(): PersistedAotSnapshot | null {
        if (!this.licenseService.isProActive()) return null;

        try {
            if (!fs.existsSync(this.aotStatePath)) return null;
            const raw = fs.readFileSync(this.aotStatePath, 'utf-8');
            const parsed = JSON.parse(raw) as PersistedAotSnapshot;
            if (!parsed || parsed.version !== CACHE_VERSION || !parsed.status) {
                throw new Error('Invalid AOT snapshot schema');
            }
            return parsed;
        } catch (err: any) {
            console.warn('[PersistenceService] AOT cache corrupted, clearing:', err?.message || err);
            this.clearAllPersistedData(true);
            return null;
        }
    }

    /**
     * Save dashboard extraction results to persistent storage (and in-memory cache).
     */
    public saveDashboardData(data: any): void {
        if (!this.licenseService.isProActive()) return;

        try {
            this.ensureDirectories();
            const payload = { version: PersistenceService.getCacheVersion(), updatedAt: new Date().toISOString(), data };
            this.writeJsonAtomic(this.dashboardPath, payload);
            this.inMemoryDashboardCache = data;
        } catch (err: any) {
            console.warn('[PersistenceService] Failed to save dashboard data:', err?.message || err);
        }
    }

    /**
     * Load previously saved dashboard extraction results if available.
     */
    public loadDashboardData(): any | null {
        if (!this.licenseService.isProActive()) return null;

        if (this.inMemoryDashboardCache) return this.inMemoryDashboardCache;

        try {
            if (!fs.existsSync(this.dashboardPath)) return null;
            const raw = fs.readFileSync(this.dashboardPath, 'utf-8');
            const parsed = JSON.parse(raw) as any;
            if (!parsed || parsed.version !== PersistenceService.getCacheVersion() || !parsed.data) {
                throw new Error('Invalid dashboard cache schema');
            }
            this.inMemoryDashboardCache = parsed.data;
            return parsed.data;
        } catch (err: any) {
            console.warn('[PersistenceService] Dashboard cache corrupted, clearing:', err?.message || err);
            try {
                if (fs.existsSync(this.dashboardPath)) fs.rmSync(this.dashboardPath, { force: true });
            } catch (e) { /* ignore */ }
            this.inMemoryDashboardCache = null;
            return null;
        }
    }

    public clearDashboardData(): void {
        this.inMemoryDashboardCache = null;
        try {
            if (fs.existsSync(this.dashboardPath)) fs.rmSync(this.dashboardPath, { force: true });
        } catch (e) { /* ignore */ }
    }

    public stageUploadedFile(filePath: string, prefix: 'resume' | 'jd'): string {
        if (!this.licenseService.isProActive()) {
            return filePath;
        }

        try {
            if (!filePath || !fs.existsSync(filePath)) {
                return filePath;
            }

            this.ensureDirectories();
            const resolved = path.resolve(filePath);
            if (resolved.startsWith(this.resumesDir + path.sep)) {
                return resolved;
            }

            const stat = fs.statSync(resolved);
            const ext = (path.extname(resolved) || '.bin').toLowerCase();
            const hash = createHash('sha256')
                .update(`${prefix}:${path.basename(resolved)}:${stat.size}:${stat.mtimeMs}`)
                .digest('hex')
                .slice(0, 32);
            const targetPath = path.join(this.resumesDir, `${prefix}-${hash}${ext}`);

            if (!fs.existsSync(targetPath)) {
                fs.copyFileSync(resolved, targetPath);
            }

            return targetPath;
        } catch (err: any) {
            console.warn('[PersistenceService] Failed to stage uploaded file:', err?.message || err);
            return filePath;
        }
    }

    public clearAllPersistedData(force: boolean = false): void {
        if (!force && !this.licenseService.isProActive()) {
            return;
        }

        this.writeGeneration += 1;

        if (this.resumeWriteTimer) {
            clearTimeout(this.resumeWriteTimer);
            this.resumeWriteTimer = null;
        }
        if (this.aotWriteTimer) {
            clearTimeout(this.aotWriteTimer);
            this.aotWriteTimer = null;
        }

        this.pendingResumeSnapshot = null;
        this.pendingAotSnapshot = null;
        this.inMemoryDashboardCache = null;

        try {
            if (fs.existsSync(this.rootDir)) {
                fs.rmSync(this.rootDir, { recursive: true, force: true });
            }
            if (fs.existsSync(this.legacyKnowledgeCachePath)) {
                fs.rmSync(this.legacyKnowledgeCachePath, { force: true });
            }
            const legacyTemp = `${this.legacyKnowledgeCachePath}.tmp`;
            if (fs.existsSync(legacyTemp)) {
                fs.rmSync(legacyTemp, { force: true });
            }
        } catch (err: any) {
            console.warn('[PersistenceService] Failed to clear pro cache:', err?.message || err);
        }
    }

    public flushPendingWritesNow(): void {
        if (!this.licenseService.isProActive() || !this.writesEnabled) {
            return;
        }

        if (this.resumeWriteTimer) {
            clearTimeout(this.resumeWriteTimer);
            this.resumeWriteTimer = null;
        }
        if (this.aotWriteTimer) {
            clearTimeout(this.aotWriteTimer);
            this.aotWriteTimer = null;
        }

        const resumeSnapshot = this.pendingResumeSnapshot;
        const aotSnapshot = this.pendingAotSnapshot;
        this.pendingResumeSnapshot = null;
        this.pendingAotSnapshot = null;

        if (!resumeSnapshot && !aotSnapshot) {
            return;
        }

        try {
            this.ensureDirectories();
            if (resumeSnapshot) {
                this.writeJsonAtomic(this.resumeMetadataPath, resumeSnapshot);
            }
            if (aotSnapshot) {
                this.writeJsonAtomic(this.aotStatePath, aotSnapshot);
            }
        } catch (err: any) {
            console.warn('[PersistenceService] Failed to flush pending writes:', err?.message || err);
        }
    }

    private async flushResumeSnapshot(): Promise<void> {
        const snapshot = this.pendingResumeSnapshot;
        this.pendingResumeSnapshot = null;
        if (!snapshot || !this.licenseService.isProActive() || !this.writesEnabled) return;

        const generation = this.writeGeneration;

        this.enqueueWrite(() => {
            this.ensureDirectories();
            this.writeJsonAtomic(this.resumeMetadataPath, snapshot);
        }, generation);
    }

    private async flushAotSnapshot(): Promise<void> {
        const snapshot = this.pendingAotSnapshot;
        this.pendingAotSnapshot = null;
        if (!snapshot || !this.licenseService.isProActive() || !this.writesEnabled) return;

        const generation = this.writeGeneration;

        this.enqueueWrite(() => {
            this.ensureDirectories();
            this.writeJsonAtomic(this.aotStatePath, snapshot);
        }, generation);
    }

    private enqueueWrite(writer: () => void, generation: number = this.writeGeneration): void {
        this.writeQueue = this.writeQueue
            .then(async () => {
                if (generation !== this.writeGeneration) {
                    return;
                }
                writer();
            })
            .catch((err: any) => {
                console.warn('[PersistenceService] Queued write failed:', err?.message || err);
            });
    }

    private ensureDirectories(): void {
        fs.mkdirSync(this.resumesDir, { recursive: true });
        fs.mkdirSync(this.aotDir, { recursive: true });
    }

    private writeJsonAtomic(filePath: string, data: object): void {
        const tempPath = `${filePath}.tmp`;
        fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
        fs.renameSync(tempPath, filePath);
    }

    public static getCacheVersion(): string {
        return CACHE_VERSION;
    }
}
