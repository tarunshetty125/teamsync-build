import { KnowledgeDatabaseManager } from './KnowledgeDatabaseManager';
import { DashboardExtractionResult, DocType, KnowledgeDocument, ContextNode, ScoredNode, KnowledgeStatus, StructuredResume, StructuredJD, IntentType, CompanyDossier } from './types';
import { extractDocumentText } from './DocumentReader';
import { extractDashboardData, extractStructuredData, mergeAndDeduplicateResumeData } from './StructuredExtractor';
import { chunkAndEmbedDocument } from './DocumentChunker';
import { processResume } from './PostProcessor';
import { getRelevantNodes, formatDossierBlock, detectCategoryHints } from './HybridSearchEngine';
import { assemblePromptContext, PromptAssemblyResult } from './ContextAssembler';
import { stableNodeKey } from './dedupeUtils';
import { classifyIntent, needsCompanyResearch } from './IntentClassifier';
import { CompanyResearchEngine, jdContextFromStructured } from './CompanyResearchEngine';
import { TechnicalDepthScorer } from './TechnicalDepthScorer';
import { AOTPipeline } from './AOTPipeline';
import { generateStarStories, generateStarStoryNodes } from './StarStoryGenerator';
import { generateMockQuestions } from './MockInterviewGenerator';
import { findRelevantValueAlignments, formatValueAlignmentBlock, CultureMappingResult } from './CultureValuesMapper';
import { SalaryIntelligenceEngine } from './SalaryIntelligenceEngine';
import { NegotiationConversationTracker } from './NegotiationConversationTracker';
import { generateLiveCoachingResponse } from './LiveNegotiationAdvisor';
import { mapToStructuredProjects, mapToStructuredEducation } from './structuredMappers';
import { AOTService } from '../services/AOTService';
import { LicenseService } from '../services/LicenseService';
import { PersistenceService } from '../services/PersistenceService';
import { ResumeService } from '../services/ResumeService';

export class KnowledgeOrchestrator {
    private db: KnowledgeDatabaseManager;
    private knowledgeModeActive: boolean = false;
    private depthScorer: TechnicalDepthScorer;
    private aotPipeline: AOTPipeline;
    private salaryEngine: SalaryIntelligenceEngine;
    private negotiationTracker: NegotiationConversationTracker;

    // Cached state for fast retrieval
    private activeResume: KnowledgeDocument | null = null;
    private activeJD: KnowledgeDocument | null = null;
    private cachedNodes: ContextNode[] = [];
    private cachedKnowledge: any = null;
    private isKnowledgeLoaded: boolean = false;
    private aotBootstrapInFlight: boolean = false;
    private hasHydrated = false;

    // Injected dependencies
    private generateContentFn: ((contents: any[]) => Promise<string>) | null = null;
    private embedFn: ((text: string) => Promise<number[]>) | null = null;

    // Company research engine
    private companyResearch: CompanyResearchEngine;
    private licenseService: LicenseService;
    private persistenceService: PersistenceService;
    private resumeService: ResumeService;
    private aotService: AOTService;

    constructor(db: KnowledgeDatabaseManager) {
        this.db = db;
        this.db.initializeSchema();
        this.licenseService = LicenseService.getInstance();
        this.persistenceService = PersistenceService.getInstance();
        this.resumeService = ResumeService.getInstance();
        this.aotService = AOTService.getInstance();

        this.persistenceService.setWritesEnabled(false);
        const proActive = this.licenseService.isProActive();

        let hydratedAotSnapshot: {
            status?: any;
            gapAnalysis?: any;
            negotiationScript?: any;
            cultureMappings?: any;
            mockQuestions?: any;
            companyDossier?: CompanyDossier | null;
        } | null = null;
        let hydratedResumeSnapshot: any = null;

        if (proActive) {
            hydratedResumeSnapshot = this.resumeService.loadPersistedSnapshot();
            if (hydratedResumeSnapshot) {
                const hydrateResult = this.resumeService.hydrateIntoDatabase(hydratedResumeSnapshot, this.db as any);
                this.knowledgeModeActive = hydrateResult.knowledgeModeActive;
                this.cachedKnowledge = hydratedResumeSnapshot;
                this.isKnowledgeLoaded = true;

                if (hydrateResult.rehydratedJdId) {
                    hydratedAotSnapshot = this.aotService.loadPersistedSnapshot() as any;
                    if (hydratedAotSnapshot) {
                        if (hydratedAotSnapshot.gapAnalysis) {
                            this.db.saveGapAnalysis(hydrateResult.rehydratedJdId, hydratedAotSnapshot.gapAnalysis);
                        }
                        if (hydratedAotSnapshot.negotiationScript) {
                            this.db.saveNegotiationScript(hydrateResult.rehydratedJdId, hydratedAotSnapshot.negotiationScript);
                        }
                        if (hydratedAotSnapshot.cultureMappings) {
                            this.db.saveCultureMappings(hydrateResult.rehydratedJdId, hydratedAotSnapshot.cultureMappings);
                        }
                        if (hydratedAotSnapshot.mockQuestions) {
                            this.db.saveMockQuestions(hydrateResult.rehydratedJdId, hydratedAotSnapshot.mockQuestions);
                        }
                    }
                }
            }
        } else {
            this.persistenceService.clearAllPersistedData(true);
        }

        this.companyResearch = new CompanyResearchEngine(db);
        this.depthScorer = new TechnicalDepthScorer();
        this.aotPipeline = new AOTPipeline(
            db,
            this.companyResearch,
            hydratedAotSnapshot
                ? {
                    status: hydratedAotSnapshot.status,
                    gapAnalysis: hydratedAotSnapshot.gapAnalysis,
                    negotiationScript: hydratedAotSnapshot.negotiationScript,
                    cultureMapping: hydratedAotSnapshot.cultureMappings,
                    companyDossier: hydratedAotSnapshot.companyDossier,
                }
                : undefined
        );
        this.salaryEngine = new SalaryIntelligenceEngine();
        this.negotiationTracker = new NegotiationConversationTracker();

        if (hydratedResumeSnapshot?.data?.jd && hydratedAotSnapshot?.companyDossier) {
            const jdCompany = ((hydratedResumeSnapshot.data.jd.structured_data as StructuredJD)?.company || '').trim();
            if (jdCompany) {
                this.companyResearch.seedCachedDossier(jdCompany, hydratedAotSnapshot.companyDossier as CompanyDossier);
            }
        }

        this.refreshCache();
        this.hasHydrated = true;
        this.aotPipeline.setHydrationComplete(true);
        this.persistenceService.setWritesEnabled(proActive);

        this.aotPipeline.setStateChangeListener(() => {
            if (!this.hasHydrated) return;
            this.persistAotCache();
        });

        this.licenseService.onLicenseRevoked(() => {
            this.handleLicenseRevoked();
        });

        this.licenseService.onLicenseActivated(() => {
            this.handleLicenseActivated();
        });
        // P2-5: do NOT seed the tracker from a cached script at construction time.
        // The script belongs to whatever JD was last persisted (possibly from a prior
        // session for a completely different company). Seeding here would contaminate a
        // fresh negotiation with stale target data.
        // The tracker target is set only when AOT completes for the *current* JD
        // (see the aotPipeline.runForJD callback in ingestDocument).
    }

    // ============================================
    // Configuration
    // ============================================

    setGenerateContentFn(fn: (contents: any[]) => Promise<string>): void {
        this.ensureHydratedFromPersistence();
        this.generateContentFn = fn;
        this.companyResearch.setGenerateContentFn(fn);
        this.aotPipeline.setGenerateContentFn(fn);
        this.maybeBootstrapAotFromCache();
    }

    setEmbedFn(fn: (text: string) => Promise<number[]>): void {
        this.embedFn = fn;
    }

    setKnowledgeMode(enabled: boolean): void {
        this.ensureHydratedFromPersistence();
        if (enabled && !this.activeResume) {
            console.warn('[KnowledgeOrchestrator] Cannot enable knowledge mode: no resume loaded');
            return;
        }
        this.knowledgeModeActive = enabled;
        console.log(`[KnowledgeOrchestrator] Knowledge mode ${enabled ? 'ENABLED' : 'DISABLED'}`);
        // Persist the toggle so it survives app restarts
        this.persistKnowledgeMode();
    }

    isKnowledgeMode(): boolean {
        this.ensureHydratedFromPersistence();
        return this.knowledgeModeActive && this.activeResume !== null;
    }

    /**
     * Get the company research engine for external use (e.g., IPC handlers).
     */
    getCompanyResearchEngine(): CompanyResearchEngine {
        return this.companyResearch;
    }

    /**
     * Get the AOT pipeline for status and results.
     */
    getAOTPipeline(): AOTPipeline {
        return this.aotPipeline;
    }

    private handleLicenseActivated(): void {
        // On license activation, rehydrate persisted resume/AOT snapshots if available
        // instead of wiping everything — this preserves user resume/calendar state
        this.persistenceService.setWritesEnabled(false);
        this.aotPipeline.setHydrationComplete(false);

        try {
            const hydratedResumeSnapshot = this.resumeService.loadPersistedSnapshot();
            if (hydratedResumeSnapshot) {
                const hydrateResult = this.resumeService.hydrateIntoDatabase(hydratedResumeSnapshot, this.db as any);
                this.knowledgeModeActive = hydrateResult.knowledgeModeActive;
                this.cachedKnowledge = hydratedResumeSnapshot;
                this.isKnowledgeLoaded = true;

                if (hydrateResult.rehydratedJdId) {
                    const hydratedAotSnapshot = this.aotService.loadPersistedSnapshot() as any;
                    if (hydratedAotSnapshot) {
                        if (hydratedAotSnapshot.gapAnalysis) {
                            this.db.saveGapAnalysis(hydrateResult.rehydratedJdId, hydratedAotSnapshot.gapAnalysis);
                        }
                        if (hydratedAotSnapshot.negotiationScript) {
                            this.db.saveNegotiationScript(hydrateResult.rehydratedJdId, hydratedAotSnapshot.negotiationScript);
                        }
                        if (hydratedAotSnapshot.cultureMappings) {
                            this.db.saveCultureMappings(hydrateResult.rehydratedJdId, hydratedAotSnapshot.cultureMappings);
                        }
                        if (hydratedAotSnapshot.mockQuestions) {
                            this.db.saveMockQuestions(hydrateResult.rehydratedJdId, hydratedAotSnapshot.mockQuestions);
                        }
                    }
                }
            }
        } catch (e) {
            // Hydration best-effort; don't block activation on failures.
            console.warn('[KnowledgeOrchestrator] hydrate on activation failed:', e);
        }

        this.hasHydrated = true;
        this.aotPipeline.setHydrationComplete(true);
        this.persistenceService.setWritesEnabled(this.licenseService.isProActive());
    }

    private handleLicenseRevoked(): void {
        // Soft-clear in-memory premium caches but preserve persisted resume/JD data
        this.persistenceService.setWritesEnabled(false);
        this.aotPipeline.setHydrationComplete(false);
        this.clearInMemoryProfileState();
        this.hasHydrated = true;
        this.aotPipeline.setHydrationComplete(true);
        console.log('[KnowledgeOrchestrator] Soft-cleared AOT/profile caches after license revocation (preserved persisted profile data)');
    }

    private clearInMemoryProfileState(): void {
        // IMPORTANT: preserve persisted resume/JD documents (don't delete DB rows).
        // Only reset in-memory caches and AOT pipeline state so the UI can hide
        // premium artifacts while keeping the underlying data intact for later
        // re-activation.
        try {
            this.aotPipeline.reset();
        } catch (e) { /* ignore */ }
        try { this.companyResearch.clearCache(); } catch (e) { /* ignore */ }
        try { this.salaryEngine.clearCache(); } catch (e) { /* ignore */ }
        try { this.negotiationTracker.reset(); } catch (e) { /* ignore */ }

        this.knowledgeModeActive = false;
        this.aotBootstrapInFlight = false;
        this.cachedKnowledge = null;
        this.isKnowledgeLoaded = false;
        this.refreshCache();
    }

    private ensureHydratedFromPersistence(): void {
        if (!this.hasHydrated) {
            throw new Error('KnowledgeOrchestrator used before hydration completed.');
        }
    }

    private hasMeaningfulDossier(dossier: CompanyDossier | null): boolean {
        if (!dossier) return false;
        return Boolean(
            (dossier.hiring_strategy && dossier.hiring_strategy.trim()) ||
            (dossier.interview_focus && dossier.interview_focus.trim()) ||
            (Array.isArray(dossier.salary_estimates) && dossier.salary_estimates.length > 0) ||
            (Array.isArray(dossier.core_values) && dossier.core_values.length > 0) ||
            (Array.isArray(dossier.employee_reviews) && dossier.employee_reviews.length > 0) ||
            (Array.isArray(dossier.critics) && dossier.critics.length > 0) ||
            (Array.isArray(dossier.benefits) && dossier.benefits.length > 0) ||
            (Array.isArray(dossier.competitors) && dossier.competitors.length > 0) ||
            (dossier.recent_news && dossier.recent_news.trim()) ||
            (Array.isArray(dossier.sources) && dossier.sources.length > 0)
        );
    }

    private deriveAotStatus(baseStatus: any, outputs: {
        companyDossier: CompanyDossier | null;
        negotiationScript: any;
        gapAnalysis: any;
        cultureMappings: any;
    }): any {
        const allowed = new Set(['pending', 'running', 'done', 'failed']);
        const normalize = (value: any): 'pending' | 'running' | 'done' | 'failed' => {
            return allowed.has(value) ? value : 'pending';
        };

        const status = {
            companyResearch: normalize(baseStatus?.companyResearch),
            negotiationScript: normalize(baseStatus?.negotiationScript),
            gapAnalysis: normalize(baseStatus?.gapAnalysis),
            starMapping: normalize(baseStatus?.starMapping),
        };

        const companyDone = this.hasMeaningfulDossier(outputs.companyDossier);
        const negotiationDone = Boolean(outputs.negotiationScript);
        const gapDone = Boolean(outputs.gapAnalysis);
        const cultureDone = Boolean(
            outputs.cultureMappings && (
                (Array.isArray(outputs.cultureMappings.mappings) && outputs.cultureMappings.mappings.length > 0) ||
                (Array.isArray(outputs.cultureMappings.core_values) && outputs.cultureMappings.core_values.length > 0)
            )
        );

        if (companyDone && status.companyResearch !== 'running') status.companyResearch = 'done';
        if (negotiationDone && status.negotiationScript !== 'running') status.negotiationScript = 'done';
        if (gapDone && status.gapAnalysis !== 'running') status.gapAnalysis = 'done';
        if (cultureDone && status.starMapping !== 'running') status.starMapping = 'done';

        return status;
    }

    private buildProcessedDataForCache(): any {
        const resume = this.db.getDocumentByType(DocType.RESUME);
        const jd = this.db.getDocumentByType(DocType.JD);

        const jdCompany = jd
            ? ((jd.structured_data as StructuredJD)?.company || '')
            : '';
        const cachedDossier = jdCompany
            ? this.companyResearch.getCachedDossier(jdCompany)
            : null;

        const gapAnalysis = this.getGapAnalysis();
        const negotiationScript = this.getNegotiationScript();
        const cultureMappings = this.getCultureMappings();
        const mockQuestions = this.getMockQuestions();
        const aotStatus = this.deriveAotStatus(this.aotPipeline.getStatus(), {
            companyDossier: cachedDossier,
            negotiationScript,
            gapAnalysis,
            cultureMappings,
        });

        return {
            resume,
            jd,
            aot: {
                companyDossier: cachedDossier,
                negotiationScript,
                gapAnalysis,
                cultureMappings,
                mockQuestions,
                status: aotStatus,
            }
        };
    }

    private hasCultureMappingData(cultureMappings: any): boolean {
        return Boolean(
            cultureMappings && (
                (Array.isArray(cultureMappings.mappings) && cultureMappings.mappings.length > 0) ||
                (Array.isArray(cultureMappings.core_values) && cultureMappings.core_values.length > 0)
            )
        );
    }

    private maybeBootstrapAotFromCache(): void {
        if (this.aotBootstrapInFlight) return;
        if (!this.generateContentFn || !this.activeJD || !this.activeResume) return;

        const jdCompany = ((this.activeJD.structured_data as StructuredJD)?.company || '').trim();
        const companyDossier = jdCompany ? this.companyResearch.getCachedDossier(jdCompany) : null;
        const negotiationScript = this.getNegotiationScript();
        const gapAnalysis = this.getGapAnalysis();
        const cultureMappings = this.getCultureMappings();
        const effectiveStatus = this.deriveAotStatus(this.aotPipeline.getStatus(), {
            companyDossier,
            negotiationScript,
            gapAnalysis,
            cultureMappings,
        });

        const hasArtifacts = Boolean(
            this.hasMeaningfulDossier(companyDossier) ||
            negotiationScript ||
            gapAnalysis ||
            this.hasCultureMappingData(cultureMappings)
        );
        const allPending = [
            effectiveStatus.companyResearch,
            effectiveStatus.negotiationScript,
            effectiveStatus.gapAnalysis,
            effectiveStatus.starMapping,
        ].every((status) => status === 'pending');

        if (!allPending || hasArtifacts) {
            return;
        }

        this.aotBootstrapInFlight = true;
        console.log('[KnowledgeOrchestrator] Bootstrapping AOT pipeline from cached resume/JD');
        this.aotPipeline.reset();
        this.aotPipeline.runForJD(this.activeJD, this.activeResume)
            .then(() => {
                const script = this.getNegotiationScript();
                if (script?.salary_range?.max) {
                    this.negotiationTracker.setUserTarget(script.salary_range.max);
                }
                this.saveKnowledgeCache(this.buildProcessedDataForCache());
            })
            .catch((err: Error) => {
                console.error('[KnowledgeOrchestrator] Cached AOT bootstrap failed:', err);
                this.saveKnowledgeCache(this.buildProcessedDataForCache());
            })
            .finally(() => {
                this.aotBootstrapInFlight = false;
            });
    }

    /**
     * Get cached gap analysis from AOT pipeline or DB.
     */
    getGapAnalysis(): any | null {
        const cached = this.aotPipeline.getCachedGapAnalysis();
        if (cached) return cached;
        // Fallback to DB
        if (this.activeJD?.id) {
            return this.db.getGapAnalysis(this.activeJD.id);
        }
        return null;
    }

    /**
     * Get cached negotiation script from AOT pipeline or DB.
     */
    getNegotiationScript(): any | null {
        const cached = this.aotPipeline.getCachedNegotiationScript();
        if (cached) return cached;
        if (this.activeJD?.id) {
            return this.db.getNegotiationScript(this.activeJD.id);
        }
        return null;
    }

    /**
     * Generate a negotiation script on-demand (used when AOT has not run yet).
     * Persists the result to DB so subsequent calls return it instantly.
     */
    async generateNegotiationScriptOnDemand(): Promise<any | null> {
        if (!this.activeResume || !this.activeJD || !this.generateContentFn) return null;
        const { generateNegotiationScript } = await import('./NegotiationEngine');
        const dossier = this.companyResearch.getCachedDossier(
            (this.activeJD.structured_data as StructuredJD).company || ''
        );
        const script = await generateNegotiationScript(
            this.activeResume, this.activeJD, dossier, this.generateContentFn
        );
        if (script && this.activeJD.id) {
            this.db.saveNegotiationScript(this.activeJD.id, script);
            // Seed tracker with the newly generated target so live coaching has a number to anchor to
            if (script.salary_range?.max) {
                this.negotiationTracker.setUserTarget(script.salary_range.max);
            }
            this.saveKnowledgeCache(this.buildProcessedDataForCache());
        }
        return script;
    }

    /**
     * Get cached mock questions from DB.
     */
    getMockQuestions(): any | null {
        if (this.activeJD?.id) {
            return this.db.getMockQuestions(this.activeJD.id);
        }
        return null;
    }

    /**
     * Get cached culture value mappings from AOT pipeline or DB.
     */
    getCultureMappings(): CultureMappingResult | null {
        const cached = this.aotPipeline.getCachedCultureMapping();
        if (cached) return cached;
        if (this.activeJD?.id) {
            return this.db.getCultureMappings(this.activeJD.id) as CultureMappingResult | null;
        }
        return null;
    }

    // ============================================
    // Status & UI
    // ============================================

    getStatus(): KnowledgeStatus {
        this.ensureHydratedFromPersistence();
        const hasResume = this.activeResume !== null;
        const hasJD = this.activeJD !== null;

        let resumeSummary;
        if (hasResume) {
            try {
                const structured = this.activeResume!.structured_data as StructuredResume;
                const { totalExperienceYears } = processResume(structured);
                resumeSummary = {
                    name: structured.identity.name,
                    role: structured.experience?.[0]?.role || 'Professional',
                    totalExperienceYears
                };
            } catch { /* ignore */ }
        }

        let jdSummary;
        if (hasJD) {
            try {
                const structured = this.activeJD!.structured_data as StructuredJD;
                jdSummary = {
                    title: structured.title || (structured as any).role || 'Unknown Title',
                    company: structured.company || 'Unknown Company'
                };
            } catch { /* ignore */ }
        }

        return {
            hasResume,
            hasActiveJD: hasJD,
            activeMode: this.knowledgeModeActive,
            resumeSummary,
            jdSummary
        };
    }

    // ============================================
    // Ingestion
    // ============================================

    async ingestDocument(filePath: string, type: DocType = DocType.RESUME): Promise<{ success: boolean; error?: string }> {
        this.ensureHydratedFromPersistence();
        if (!this.generateContentFn || !this.embedFn) {
            return { success: false, error: 'LLM and embedding functions not configured.' };
        }

        try {
            console.log(`[KnowledgeOrchestrator] Starting ingestion for ${type} from: ${filePath}`);
            const stagedFilePath = this.resumeService.stageUploadedFile(filePath, type);

            const cachedKnowledge = this.getCachedKnowledge(type, stagedFilePath);
            const existingDoc = this.db.getDocumentByType(type);
            if (cachedKnowledge && this.isKnowledgeLoaded && existingDoc?.source_uri === stagedFilePath) {
                this.refreshCache();
                return { success: true };
            }

            // User re-uploaded this document type; invalidate cache before recomputing.
            if (existingDoc) {
                this.invalidateKnowledgeCache();
            }

            // 1. Extract Text
            const rawText = await extractDocumentText(stagedFilePath);

            // 2. Extract Structured JSON
            let structuredData = await extractStructuredData<any>(rawText, type, this.generateContentFn);

            // 3. Post-Process (if resume)
            if (type === DocType.RESUME) {
                const processed = processResume(structuredData as StructuredResume);
                structuredData = processed.structured; // Save the normalized version
            }

            // Create a merged/enriched view for saving/indexing/LLM use.
            // This is JIT enrichment: StructuredResume remains the source-of-truth
            // and mergeAndDeduplicateResumeData will prefer structured data when present.
            let structuredDataToUse: any = structuredData;
            try {
                if (type === DocType.RESUME && structuredData) {
                    const merged = mergeAndDeduplicateResumeData(structuredData as StructuredResume, undefined, undefined);
                    const projects = mapToStructuredProjects(merged.projects);
                    const education = mapToStructuredEducation(merged.education);
                    structuredDataToUse = { ...(structuredData as any), projects, education };
                }
            } catch (e) {
                structuredDataToUse = structuredData;
            }

            // 4. Delete old documents of this type (we assume 1 active resume and 1 active JD for now)
            this.db.deleteDocumentsByType(type);

            // 5. Save Document Metadata
            const docId = this.db.saveDocument({
                type,
                source_uri: stagedFilePath,
                structured_data: structuredDataToUse
            });

            // Steps 6-8 can fail — recover by deleting the partially saved document
            try {
                // 6. Chunk and Embed
                const nodesWithEmbeddings = await chunkAndEmbedDocument(structuredDataToUse, type, this.embedFn);

                // 7. Save Nodes
                this.db.saveNodes(nodesWithEmbeddings, docId);

                // 8. Generate STAR Stories (Resume Only)
                if (type === DocType.RESUME) {
                    try {
                        console.log(`[KnowledgeOrchestrator] Generating STAR stories for resume...`);
                        const starNodes = await generateStarStoryNodes(structuredDataToUse as StructuredResume, this.generateContentFn, this.embedFn);
                        this.db.saveNodes(starNodes, docId);
                    } catch (err: any) {
                        console.error('[KnowledgeOrchestrator] Failed to generate STAR stories:', err.message);
                        // Non-fatal — STAR stories are optional enrichment
                    }
                }
            } catch (embedError: any) {
                // Rollback: delete the partially saved document + any nodes (cascade)
                console.error(`[KnowledgeOrchestrator] Embedding/storage failed, rolling back document ${docId}:`, embedError.message);
                this.db.deleteDocumentsByType(type);
                this.refreshCache();
                return { success: false, error: `Embedding failed: ${embedError.message}. Document rolled back.` };
            }

            this.refreshCache();
            this.saveKnowledgeCache(this.buildProcessedDataForCache());

            console.log(`[KnowledgeOrchestrator] ✅ Ingestion complete for ${type}`);

            // 9. Fire AOT Pipeline (JD Only)
            if (type === DocType.JD) {
                this.aotPipeline.reset();
                this.aotPipeline.runForJD(
                    this.db.getDocumentByType(DocType.JD)!,
                    this.db.getDocumentByType(DocType.RESUME)
                ).then(() => {
                    // AOT may have generated a negotiation script; seed tracker target now
                    const script = this.getNegotiationScript();
                    if (script?.salary_range?.max) {
                        this.negotiationTracker.setUserTarget(script.salary_range.max);
                    }
                    this.saveKnowledgeCache(this.buildProcessedDataForCache());
                }).catch((err: Error) => {
                    console.error('[KnowledgeOrchestrator] AOT Pipeline failed:', err);
                    this.saveKnowledgeCache(this.buildProcessedDataForCache());
                });
            }

            // 10. Pre-compute salary estimate (Resume Only, non-blocking)
            if (type === DocType.RESUME && this.generateContentFn) {
                const resumeData = structuredDataToUse as StructuredResume;
                const { totalExperienceYears } = processResume(resumeData);
                this.salaryEngine.estimateFromResume(
                    resumeData, totalExperienceYears, this.generateContentFn
                ).catch((err: Error) => console.error('[KnowledgeOrchestrator] Salary pre-compute failed:', err));
            }

            return { success: true };

        } catch (error: any) {
            console.error('[KnowledgeOrchestrator] Ingestion failed:', error);
            return { success: false, error: error.message };
        }
    }

    // ============================================
    // Chat Integration
    // ============================================

    private isDirectNegotiationPrompt(question: string): boolean {
        const text = (question || '').toLowerCase().trim();
        if (!text) return false;

        const syntheticMarkers = [
            'conversation:',
            '<intent_and_shape>',
            'detected intent:',
            'answer shape:',
            'previous responses (avoid repetition):',
            '<mock_question_hint>',
            '<live_negotiation_state>',
            'current negotiation state:'
        ];

        if (syntheticMarkers.some(marker => text.includes(marker))) return false;
        if (question.length > 260) return false;
        if ((question.match(/\n/g) || []).length > 3) return false;

        const negotiationTerms = [
            'salary', 'compensation', 'offer', 'counter', 'negotiate', 'negotiation',
            'base', 'total comp', 'equity', 'bonus', 'sign-on', 'signing bonus',
            'range', 'package', 'benefits', 'pay'
        ];
        return negotiationTerms.some(term => text.includes(term));
    }

    async processQuestion(question: string): Promise<PromptAssemblyResult | null> {
        this.ensureHydratedFromPersistence();
        if (!this.isKnowledgeMode() || !this.activeResume) {
            return null;
        }

        // Feed user utterance for silence timer detection
        this.negotiationTracker.addUserUtterance(question);

        // Classify intent
        const intent = classifyIntent(question);
        const isDirectNegotiation = intent === IntentType.NEGOTIATION && this.isDirectNegotiationPrompt(question);
        const wantsCompanyResearch = needsCompanyResearch(question);
        const questionPreview = question.length > 120 ? `${question.slice(0, 120)}...` : question;
        console.log(`[KnowledgeOrchestrator] Intent classified: ${intent} | directNegotiation=${isDirectNegotiation} | companyResearch=${wantsCompanyResearch} | q="${questionPreview}"`);

        // Detect category hints for boosting (e.g. "projects" → boost project nodes)
        const categoryHints = detectCategoryHints(question);
        if (categoryHints.length > 0) {
            console.log(`[KnowledgeOrchestrator] Category hints detected: ${categoryHints.join(', ')}`);
        }

        const TOP_K = 3;

        // Get JD required skills for boosting
        let jdRequiredSkills: string[] = [];
        if (this.activeJD) {
            const jd = this.activeJD.structured_data as StructuredJD;
            jdRequiredSkills = [...(jd.requirements || []), ...(jd.technologies || [])];
        }

        // Retrieve relevant nodes with JD boost and category hints
        let selectedNodes: ScoredNode[] = [];
        if (this.embedFn && this.cachedNodes.length > 0) {
            try {
                const scoredNodes = await getRelevantNodes(question, this.cachedNodes, this.embedFn, {
                    sourceTypes: [DocType.RESUME, DocType.JD],
                    jdRequiredSkills,
                    categoryHintKeywords: categoryHints.length > 0 ? categoryHints : undefined,
                    maxNodes: Math.max(TOP_K, 6)
                });
                selectedNodes = scoredNodes.slice(0, TOP_K);
            } catch (error: any) {
                console.warn('[KnowledgeOrchestrator] Relevance scoring failed:', error.message);
            }
        }

        if (!selectedNodes.length) {
            return {
                systemPromptInjection: '',
                contextBlock: '',
                isIntroQuestion: false,
                answer: "I don't have enough information from the provided data.",
                confidence: 0
            };
        }

        const confidence = selectedNodes.reduce((sum, n) => sum + n.score, 0) / selectedNodes.length;
        if (confidence < 0.25) {
            return {
                systemPromptInjection: '',
                contextBlock: '',
                isIntroQuestion: false,
                answer: "I don't have enough information from the provided data.",
                confidence
            };
        }

        if (confidence < 0.35) {
            return {
                systemPromptInjection: '',
                contextBlock: '',
                isIntroQuestion: false,
                answer: "I don't have enough information from the provided data.",
                confidence
            };
        }

        const relevantNodes: ContextNode[] = selectedNodes.map(sn => sn.node);

        // Company research — prefer pre-computed AOT dossier, fallback to DB cache
        let dossierContext = '';
        if (wantsCompanyResearch && this.activeJD) {
            const jd = this.activeJD.structured_data as StructuredJD;
            if (jd.company) {
                try {
                    // 1. Try AOT pipeline cache (in-memory)
                    let dossier = this.aotPipeline.getCachedDossier();
                    // 2. Fallback: DB cache (persisted from previous AOT runs)
                    if (!dossier) {
                        dossier = this.companyResearch.getCachedDossier(jd.company);
                    }
                    // 3. Last resort: live research (only if no cached data exists at all)
                    if (!dossier) {
                        console.warn('[KnowledgeOrchestrator] No cached dossier found, running live research (consider uploading JD first)');
                        dossier = await this.companyResearch.researchCompany(
                            jd.company, jdContextFromStructured(jd)
                        );
                    }
                    dossierContext = formatDossierBlock(dossier);
                } catch (error: any) {
                    console.warn('[KnowledgeOrchestrator] Company research failed:', error.message);
                }
            }
        }

        // Live negotiation path — only when tracker has active state
        if (isDirectNegotiation) {
            if (this.negotiationTracker.isActive() && this.generateContentFn && this.activeResume) {
                const dossier = this.activeJD
                    ? this.companyResearch.getCachedDossier(
                        (this.activeJD.structured_data as StructuredJD).company || ''
                    )
                    : null;
                const script = this.getNegotiationScript();
                const coachingResponse = await generateLiveCoachingResponse(
                    this.negotiationTracker,
                    question,
                    this.activeResume,
                    this.activeJD,
                    dossier,
                    script,
                    this.generateContentFn
                );
                return {
                    systemPromptInjection: '',
                    contextBlock: '',
                    isIntroQuestion: false,
                    liveNegotiationResponse: coachingResponse,
                };
            }
        }

        // Salary intelligence injection — for negotiation/salary questions
        let salaryContext = '';
        if (isDirectNegotiation && this.activeResume && this.generateContentFn) {
            try {
                const resume = this.activeResume.structured_data as StructuredResume;
                const { totalExperienceYears } = processResume(resume);

                if (this.activeJD) {
                    // JD mode: use pre-computed negotiation script + dossier salary data
                    const negotiationScript = this.getNegotiationScript();
                    const resumeEstimate = this.salaryEngine.getCachedEstimate();
                    salaryContext = SalaryIntelligenceEngine.buildSalaryContextBlock(
                        resumeEstimate, negotiationScript, true
                    );
                    console.log('[KnowledgeOrchestrator] Injecting JD-based salary intelligence');
                } else {
                    // Resume-only mode: generate salary estimate from resume data
                    const resumeEstimate = await this.salaryEngine.estimateFromResume(
                        resume, totalExperienceYears, this.generateContentFn
                    );
                    salaryContext = SalaryIntelligenceEngine.buildSalaryContextBlock(
                        resumeEstimate, null, false
                    );
                    console.log('[KnowledgeOrchestrator] Injecting resume-based salary intelligence');
                }
            } catch (error: any) {
                console.warn('[KnowledgeOrchestrator] Salary intelligence failed:', error.message);
            }
        }
        // Gap analysis pivot injection — if question mentions a gap skill, inject the pre-computed pivot script
        let gapContext = '';
        if (this.activeJD) {
            const gapAnalysis = this.getGapAnalysis() as import('./types').GapAnalysisResult | null;
            if (gapAnalysis && gapAnalysis.gaps && gapAnalysis.gaps.length > 0) {
                const questionLower = question.toLowerCase();
                const matchingGaps = gapAnalysis.gaps.filter(gap =>
                    questionLower.includes(gap.skill.toLowerCase())
                );
                if (matchingGaps.length > 0) {
                    const pivotLines = matchingGaps.map(gap =>
                        `[Gap: ${gap.skill} (${gap.gap_type})] Pivot: ${gap.pivot_script}${gap.transferable_skills.length > 0 ? ` Transferable skills: ${gap.transferable_skills.join(', ')}` : ''}`
                    );
                    gapContext = `<gap_pivot_scripts>\n${pivotLines.join('\n')}\n</gap_pivot_scripts>`;
                    console.log(`[KnowledgeOrchestrator] Injecting ${matchingGaps.length} pivot script(s) for detected gap skills`);
                }
            }
        }

        // Get tone directive from technical depth scorer
        const toneXML = this.depthScorer.getToneXML();

        // Pass everything to the Context Assembler for JIT prompt construction
        const result = await assemblePromptContext(
            question,
            this.activeResume,
            this.activeJD,
            relevantNodes.map(n => ({ node: n, score: 1 })),
            this.generateContentFn,
            toneXML
        );

        // Append dossier context if available
        if (dossierContext && result) {
            result.contextBlock = result.contextBlock
                ? `${result.contextBlock}\n\n${dossierContext}`
                : dossierContext;
        }

        // Append salary intelligence if available
        if (salaryContext && result) {
            result.contextBlock = result.contextBlock
                ? `${result.contextBlock}\n\n${salaryContext}`
                : salaryContext;
        }

        // Append gap pivot scripts if available
        if (gapContext && result) {
            result.contextBlock = result.contextBlock
                ? `${result.contextBlock}\n\n${gapContext}`
                : gapContext;
        }

        // Mock question matching — if the interviewer's question matches a pre-computed mock question,
        // inject the suggested answer key to help the candidate
        if (this.activeJD && result) {
            const mockQuestions = this.getMockQuestions() as import('./types').MockQuestion[] | null;
            if (mockQuestions && mockQuestions.length > 0) {
                const questionLower = question.toLowerCase();
                const questionWords = new Set(questionLower.split(/\s+/).filter(w => w.length > 3));

                // Score each mock question by keyword overlap with the interviewer's question
                const scoredMocks = mockQuestions.map(mq => {
                    const mqWords = mq.question.toLowerCase().split(/\s+/).filter(w => w.length > 3);
                    const overlap = mqWords.filter(w => questionWords.has(w)).length;
                    const similarity = mqWords.length > 0 ? overlap / mqWords.length : 0;
                    return { mock: mq, similarity };
                }).filter(s => s.similarity >= 0.4) // At least 40% word overlap
                    .sort((a, b) => b.similarity - a.similarity);

                if (scoredMocks.length > 0) {
                    const bestMatch = scoredMocks[0];
                    const hintLines = [
                        `Predicted Question: "${bestMatch.mock.question}"`,
                        `Category: ${bestMatch.mock.category} | Difficulty: ${bestMatch.mock.difficulty}`,
                        `Key Points to Hit: ${bestMatch.mock.suggested_answer_key}`,
                        `Why This Is Asked: ${bestMatch.mock.rationale}`
                    ];
                    const mockBlock = `<mock_question_hint>\nThis question closely matches a predicted interview question. Use these key points:\n${hintLines.join('\n')}\n</mock_question_hint>`;

                    result.contextBlock = result.contextBlock
                        ? `${result.contextBlock}\n\n${mockBlock}`
                        : mockBlock;
                    console.log(`[KnowledgeOrchestrator] Injecting mock question hint (${(bestMatch.similarity * 100).toFixed(0)}% match): "${bestMatch.mock.question.substring(0, 60)}..."`);
                }
            }
        }

        // Culture values alignment injection
        const cultureMappings = this.getCultureMappings();
        if (cultureMappings && cultureMappings.mappings.length > 0 && this.activeJD && result) {
            const jd = this.activeJD.structured_data as StructuredJD;
            const alignments = findRelevantValueAlignments(
                question, cultureMappings.mappings, cultureMappings.core_values, 2
            );
            if (alignments.length > 0) {
                const cultureBlock = formatValueAlignmentBlock(alignments, jd.company);
                if (cultureBlock) {
                    result.contextBlock = result.contextBlock
                        ? `${result.contextBlock}\n\n${cultureBlock}`
                        : cultureBlock;
                    console.log(`[KnowledgeOrchestrator] Injecting ${alignments.length} culture alignment(s) for ${jd.company}`);
                }
            }
        }

        result.confidence = confidence;

        return result;
    }

    // ============================================
    // Management
    // ============================================

    deleteDocumentsByType(type: DocType): void {
        this.ensureHydratedFromPersistence();
        this.db.deleteDocumentsByType(type);
        this.aotPipeline.reset();
        this.invalidateKnowledgeCache();
        if (type === DocType.RESUME) {
            this.knowledgeModeActive = false;
            this.salaryEngine.clearCache();
            this.negotiationTracker.reset();
        } else if (type === DocType.JD) {
            // Replacing a JD means the user is targeting a different role/company.
            // Phase, offer history, and pushback counts from the previous session must
            // not bleed into the new negotiation — reset unconditionally.
            this.companyResearch.clearCache();
            this.negotiationTracker.reset();
        }
        this.refreshCache();
    }

    public clearAllProfileData(): void {
        this.clearInMemoryProfileState();
        this.persistenceService.clearAllPersistedData(true);
        console.log('[KnowledgeOrchestrator] Cleared all persisted profile/JD data after license deactivation');
    }

    /**
     * Clear in-memory caches and transient pipeline results without touching persistence.
     * Useful for immediate memory-only reset when license is revoked.
     */
    public clearAllCaches(): void {
        try {
            this.aotPipeline.reset();
        } catch (e) { /* ignore */ }

        try {
            this.cachedNodes = [];
            this.cachedKnowledge = null;
            this.companyResearch.clearCache();
            this.salaryEngine.clearCache();
            this.negotiationTracker.reset();
            if (typeof (this.db as any).clearAll === 'function') {
                (this.db as any).clearAll();
            }
            this.refreshCache();
            console.log('[KnowledgeOrchestrator] clearAllCaches executed');
        } catch (err) {
            console.warn('[KnowledgeOrchestrator] clearAllCaches failed:', err);
        }
    }

    private refreshCache(): void {
        this.activeResume = this.db.getDocumentByType(DocType.RESUME);
        this.activeJD = this.db.getDocumentByType(DocType.JD);
        // Load raw nodes then deduplicate globally to ensure retrieval sees a stable set.
        try {
            const raw = this.db.getAllNodes();
            const seen = new Set<string>();
            const deduped: ContextNode[] = [];
            for (const n of raw) {
                try {
                    const k = stableNodeKey(n) || '';
                    if (!k) {
                        deduped.push(n);
                        continue;
                    }
                    if (!seen.has(k)) {
                        seen.add(k);
                        deduped.push(n);
                    }
                } catch (e) {
                    deduped.push(n);
                }
            }
            this.cachedNodes = deduped;
        } catch (e) {
            this.cachedNodes = this.db.getAllNodes();
        }
        console.log(`[KnowledgeOrchestrator] Cache refreshed: ${this.cachedNodes.length} total nodes across all docs (deduped)`);
    }

    private getCachedKnowledge(type: DocType, filePath: string): any | null {
        // Load from memory first.
        if (this.cachedKnowledge && this.isKnowledgeLoaded) {
            if (!this.cachedKnowledge?.data?.resume && !this.cachedKnowledge?.data?.jd) {
                this.invalidateKnowledgeCache();
                return null;
            }
            const key = type === DocType.RESUME ? 'resume' : type === DocType.JD ? 'jd' : null;
            const cachedDoc = key ? this.cachedKnowledge?.data?.[key] : null;
            if (cachedDoc?.source_uri !== filePath) {
                return null;
            }
            return this.cachedKnowledge;
        }
        return null;
    }

    private saveKnowledgeCache(processedData: any): void {
        if (!processedData?.resume && !processedData?.jd) {
            this.cachedKnowledge = null;
            this.isKnowledgeLoaded = false;
            return;
        }

        // Also persist nodes (with embeddings) so they survive restarts
        // without needing to re-embed.
        const allNodes = this.db.getAllNodes();
        const resumeDoc = processedData.resume;
        const jdDoc = processedData.jd;
        const resumeNodes = resumeDoc?.id != null
            ? allNodes.filter(n => n.document_id === resumeDoc.id)
            : [];
        const jdNodes = jdDoc?.id != null
            ? allNodes.filter(n => n.document_id === jdDoc.id)
            : [];

        const payload = {
            version: PersistenceService.getCacheVersion(),
            updatedAt: new Date().toISOString(),
            data: {
                ...processedData,
                resumeNodes,
                jdNodes,
                knowledgeModeActive: this.knowledgeModeActive,
            }
        };

        this.cachedKnowledge = payload;
        this.isKnowledgeLoaded = true;

        if (this.hasHydrated && this.licenseService.isProActive()) {
            this.resumeService.queuePersist({
                resume: processedData.resume,
                jd: processedData.jd,
                resumeNodes,
                jdNodes,
                knowledgeModeActive: this.knowledgeModeActive,
            });
            this.persistAotCache();
        }
    }

    private persistAotCache(): void {
        if (!this.hasHydrated || !this.licenseService.isProActive()) return;

        const persistedResume = this.db.getDocumentByType(DocType.RESUME);
        const persistedJd = this.db.getDocumentByType(DocType.JD);
        if (!persistedResume && !persistedJd) {
            this.persistenceService.clearAllPersistedData(true);
            return;
        }

        const status = this.aotPipeline.getStatus();
        const gapAnalysis = this.getGapAnalysis();
        const negotiationScript = this.getNegotiationScript();
        const cultureMappings = this.getCultureMappings();
        const mockQuestions = this.getMockQuestions();
        const company = ((persistedJd?.structured_data as StructuredJD | undefined)?.company || '').trim();
        const companyDossier = company ? this.companyResearch.getCachedDossier(company) : null;

        this.aotService.queuePersist({
            status,
            gapAnalysis,
            negotiationScript,
            cultureMappings,
            mockQuestions,
            companyDossier,
        });
    }

    private invalidateKnowledgeCache(): void {
        this.cachedKnowledge = null;
        this.isKnowledgeLoaded = false;
        this.persistenceService.clearAllPersistedData(true);
    }

    /**
     * Persist only the knowledgeModeActive flag into the existing cache.
     * Lightweight update — avoids full re-serialization of nodes.
     */
    private persistKnowledgeMode(): void {
        if (this.cachedKnowledge?.data) {
            this.cachedKnowledge.data.knowledgeModeActive = this.knowledgeModeActive;
            this.saveKnowledgeCache(this.buildProcessedDataForCache());
        }
    }

    // ============================================
    // Compact JD Header
    // ============================================

    /**
     * Generate a compact JD header (~150 tokens) for persona injection.
     */
    async generateCompactJDHeader(): Promise<string | null> {
        if (!this.activeJD || !this.generateContentFn) return null;

        const jd = this.activeJD.structured_data as StructuredJD;
        const prompt = `Create a compact summary (~150 tokens) of this job for persona tuning. Include: role title, level, company, top 3 technical themes, and key focus areas. Output a single paragraph, no markdown.

Job: ${jd.title} at ${jd.company}
Level: ${jd.level || 'mid'}
Location: ${jd.location}
Key Requirements: ${jd.requirements?.slice(0, 5).join(', ')}
Technologies: ${jd.technologies?.join(', ')}
Keywords: ${jd.keywords?.join(', ')}`;

        try {
            const header = await this.generateContentFn([{ text: prompt }]);
            return header.trim();
        } catch (error: any) {
            console.warn('[KnowledgeOrchestrator] Failed to generate compact JD header:', error.message);
            return `${jd.level || 'Mid-level'} ${jd.title} at ${jd.company}. Focus: ${jd.keywords?.slice(0, 3).join(', ') || jd.technologies?.slice(0, 3).join(', ') || 'general'}.`;
        }
    }

    /**
     * Get a deterministic compact JD header for persona merging.
     */
    getCompactJDHeader(): string | null {
        if (!this.activeJD) return null;
        const jd = this.activeJD.structured_data as StructuredJD;
        const levelStr = jd.level ? jd.level.charAt(0).toUpperCase() + jd.level.slice(1) : 'Mid-level';
        const techFocus = jd.technologies?.slice(0, 4).join(', ') || '';
        const keyThemes = jd.keywords?.slice(0, 3).join(', ') || '';
        return `${levelStr} ${jd.title} at ${jd.company}${jd.location ? ` (${jd.location})` : ''}. Focus: ${techFocus}. Themes: ${keyThemes}.`;
    }

    // Temporary helper for UI compatibility while refactoring
    getProfileData(): any {
        this.ensureHydratedFromPersistence();
        if (!this.activeResume) return null;
        try {
            this.maybeBootstrapAotFromCache();
            const structured = this.activeResume.structured_data as StructuredResume;

            // JD data
            let jdData = null;
            if (this.activeJD) {
                const jd = this.activeJD.structured_data as StructuredJD;
                jdData = {
                    title: jd.title || (jd as any).role || 'Unknown Title',
                    company: jd.company || 'Unknown Company',
                    location: jd.location || 'Unknown Location',
                    level: jd.level,
                    requirements: jd.requirements,
                    technologies: jd.technologies,
                    keywords: jd.keywords,
                    compensation_hint: jd.compensation_hint,
                    min_years_experience: jd.min_years_experience
                };
            }

            // Get AOT results
            const gapAnalysis = this.getGapAnalysis();
            const negotiationScript = this.getNegotiationScript();
            const mockQuestions = this.getMockQuestions();
            const cultureMappings = this.getCultureMappings();
            const companyDossier = jdData?.company
                ? this.companyResearch.getCachedDossier(jdData.company)
                : null;
            const aotStatus = this.deriveAotStatus(this.aotPipeline.getStatus(), {
                companyDossier,
                negotiationScript,
                gapAnalysis,
                cultureMappings,
            });

            return {
                identity: structured.identity,
                skills: structured.skills,
                experienceCount: structured.experience?.length || 0,
                projectCount: structured.projects?.length || 0,
                educationCount: structured.education?.length || 0,
                nodeCount: this.db.getNodeCount(DocType.RESUME),

                // Expose raw data for detailed visualizations
                experience: structured.experience || [],
                projects: structured.projects || [],
                education: structured.education || [],

                // JD context
                activeJD: jdData,
                hasActiveJD: this.activeJD !== null,

                // AOT pipeline results
                gapAnalysis,
                negotiationScript,
                mockQuestions,
                cultureMappings,
                aotStatus,

                // Dynamic persona info
                compactPersona: this.getCompactJDHeader() || 'Resume-Aware Mode Active',
                toneDirective: this.depthScorer.getToneDirective()
            };
        } catch {
            return null;
        }
    }

    async extractDashboardDataFromTexts(resumeText: string, jdText: string): Promise<DashboardExtractionResult> {
        this.ensureHydratedFromPersistence();
        if (!this.generateContentFn) {
            throw new Error('Knowledge engine is not ready. Please ensure API keys are configured.');
        }

        return extractDashboardData(resumeText, jdText, this.generateContentFn);
    }

    /**
     * Feed an interviewer's STT transcript to the technical depth scorer and negotiation tracker.
     * Call this ONLY from the verified STT path in main.ts where speaker === 'interviewer'.
     */
    feedInterviewerUtterance(text: string): void {
        this.depthScorer.addUtterance(text);
        this.negotiationTracker.addRecruiterUtterance(text);
    }

    /**
     * Feed text to the depth scorer only — does NOT touch the negotiation tracker.
     * Use this from chatWithGemini/streamChat where the message is the user's question to the AI,
     * not a verified recruiter utterance. Prevents misclassifying user questions as recruiter offers.
     */
    feedForDepthScoring(text: string): void {
        this.depthScorer.addUtterance(text);
    }

    getNegotiationTracker(): NegotiationConversationTracker {
        return this.negotiationTracker;
    }

    resetNegotiationSession(): void {
        this.negotiationTracker.reset();
    }

    /**
     * Get extracted vocabulary for STT hints, filtering out long sentences.
     */
    getVocabularyHints(): string[] {
        this.ensureHydratedFromPersistence();
        const hints = new Set<string>();
        if (this.activeJD) {
            const jd = this.activeJD.structured_data as StructuredJD;
            if (jd.company) hints.add(jd.company);
            if (jd.title) hints.add(jd.title);
            jd.technologies?.forEach(t => hints.add(t));
            jd.keywords?.forEach(k => hints.add(k));

            // Only include short, keyword-like entries for STT hints
            for (const req of (jd.requirements || [])) {
                if (req.trim().split(/\s+/).length <= 3) {
                    hints.add(req.trim());
                }
            }
        }
        return Array.from(hints);
    }
}
