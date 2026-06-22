import { AOTStatus, CompanyDossier } from '../knowledge/types';
import { PersistedAotSnapshot, PersistenceService } from './PersistenceService';
import { LicenseService } from './LicenseService';

const TOTAL_AOT_STEPS = 4;

export class AOTService {
    private static instance: AOTService;

    private readonly licenseService: LicenseService;
    private readonly persistenceService: PersistenceService;

    private constructor() {
        this.licenseService = LicenseService.getInstance();
        this.persistenceService = PersistenceService.getInstance();
    }

    public static getInstance(): AOTService {
        if (!AOTService.instance) {
            AOTService.instance = new AOTService();
        }
        return AOTService.instance;
    }

    public queuePersist(params: {
        status: AOTStatus;
        gapAnalysis?: any;
        negotiationScript?: any;
        cultureMappings?: any;
        mockQuestions?: any;
        companyDossier?: CompanyDossier | null;
    }): void {
        if (!this.licenseService.isProActive()) return;

        const payload: PersistedAotSnapshot = {
            version: PersistenceService.getCacheVersion(),
            updatedAt: new Date().toISOString(),
            status: params.status,
            progress: this.computeProgress(params.status),
            gapAnalysis: params.gapAnalysis,
            negotiationScript: params.negotiationScript,
            cultureMappings: params.cultureMappings,
            mockQuestions: params.mockQuestions,
            companyDossier: params.companyDossier ?? null,
        };

        this.persistenceService.queueAotSnapshot(payload);
    }

    public loadPersistedSnapshot(): PersistedAotSnapshot | null {
        return this.persistenceService.loadAotSnapshot();
    }

    public computeProgress(status: AOTStatus): number {
        const states = [
            status.companyResearch,
            status.negotiationScript,
            status.gapAnalysis,
            status.starMapping,
        ];

        const completed = states.filter((state) => state === 'done' || state === 'failed').length;
        return Math.round((completed / TOTAL_AOT_STEPS) * 100);
    }
}
