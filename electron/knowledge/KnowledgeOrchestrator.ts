import { KnowledgeDatabaseManager } from './KnowledgeDatabaseManager';
import { DocType, KnowledgeDocument, ContextNode, KnowledgeStatus, StructuredResume, StructuredJD, IntentType, CompanyDossier } from './types';
import { extractDocumentText } from './DocumentReader';
import { extractStructuredData } from './StructuredExtractor';
import { chunkAndEmbedDocument } from './DocumentChunker';
import { processResume } from './PostProcessor';
import { getRelevantNodes, formatDossierBlock } from './HybridSearchEngine';
import { assemblePromptContext, PromptAssemblyResult } from './ContextAssembler';
import { classifyIntent, needsCompanyResearch } from './IntentClassifier';
import { CompanyResearchEngine } from './CompanyResearchEngine';

export class KnowledgeOrchestrator {
    private db: KnowledgeDatabaseManager;
    private knowledgeModeActive: boolean = false;

    // Cached state for fast retrieval
    private activeResume: KnowledgeDocument | null = null;
    private activeJD: KnowledgeDocument | null = null;
    private cachedNodes: ContextNode[] = [];

    // Injected dependencies
    private generateContentFn: ((contents: any[]) => Promise<string>) | null = null;
    private embedFn: ((text: string) => Promise<number[]>) | null = null;

    // Company research engine
    private companyResearch: CompanyResearchEngine;

    constructor(db: KnowledgeDatabaseManager) {
        this.db = db;
        this.db.initializeSchema();
        this.companyResearch = new CompanyResearchEngine(db);
        this.refreshCache();
    }

    // ============================================
    // Configuration
    // ============================================

    setGenerateContentFn(fn: (contents: any[]) => Promise<string>): void {
        this.generateContentFn = fn;
        this.companyResearch.setGenerateContentFn(fn);
    }

    setEmbedFn(fn: (text: string) => Promise<number[]>): void {
        this.embedFn = fn;
    }

    setKnowledgeMode(enabled: boolean): void {
        if (enabled && !this.activeResume) {
            console.warn('[KnowledgeOrchestrator] Cannot enable knowledge mode: no resume loaded');
            return;
        }
        this.knowledgeModeActive = enabled;
        console.log(`[KnowledgeOrchestrator] Knowledge mode ${enabled ? 'ENABLED' : 'DISABLED'}`);
    }

    isKnowledgeMode(): boolean {
        return this.knowledgeModeActive && this.activeResume !== null;
    }

    /**
     * Get the company research engine for external use (e.g., IPC handlers).
     */
    getCompanyResearchEngine(): CompanyResearchEngine {
        return this.companyResearch;
    }

    // ============================================
    // Status & UI
    // ============================================

    getStatus(): KnowledgeStatus {
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
                    title: structured.title,
                    company: structured.company
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
        if (!this.generateContentFn || !this.embedFn) {
            return { success: false, error: 'LLM and embedding functions not configured.' };
        }

        try {
            console.log(`[KnowledgeOrchestrator] Starting ingestion for ${type} from: ${filePath}`);

            // 1. Extract Text
            const rawText = await extractDocumentText(filePath);

            // 2. Extract Structured JSON
            let structuredData = await extractStructuredData<any>(rawText, type, this.generateContentFn);

            // 3. Post-Process (if resume)
            if (type === DocType.RESUME) {
                const processed = processResume(structuredData as StructuredResume);
                structuredData = processed.structured; // Save the normalized version
            }

            // 4. Delete old documents of this type (we assume 1 active resume and 1 active JD for now)
            this.db.deleteDocumentsByType(type);

            // 5. Save Document Metadata
            const docId = this.db.saveDocument({
                type,
                source_uri: filePath,
                structured_data: structuredData
            });

            // 6. Chunk and Embed
            const nodesWithEmbeddings = await chunkAndEmbedDocument(structuredData, type, this.embedFn);

            // 7. Save Nodes
            this.db.saveNodes(nodesWithEmbeddings, docId);

            this.refreshCache();
            console.log(`[KnowledgeOrchestrator] ✅ Ingestion complete for ${type}`);
            return { success: true };

        } catch (error: any) {
            console.error('[KnowledgeOrchestrator] Ingestion failed:', error);
            return { success: false, error: error.message };
        }
    }

    // ============================================
    // Chat Integration
    // ============================================

    async processQuestion(question: string): Promise<PromptAssemblyResult | null> {
        if (!this.isKnowledgeMode() || !this.activeResume) {
            return null;
        }

        // Classify intent
        const intent = classifyIntent(question);
        console.log(`[KnowledgeOrchestrator] Intent classified: ${intent}`);

        // Get JD required skills for boosting
        let jdRequiredSkills: string[] = [];
        if (this.activeJD) {
            const jd = this.activeJD.structured_data as StructuredJD;
            jdRequiredSkills = [...(jd.requirements || []), ...(jd.technologies || [])];
        }

        // Retrieve relevant nodes with JD boost
        let relevantNodes: ContextNode[] = [];
        if (this.embedFn && this.cachedNodes.length > 0) {
            try {
                const scoredNodes = await getRelevantNodes(question, this.cachedNodes, this.embedFn, {
                    sourceTypes: [DocType.RESUME, DocType.JD],
                    jdRequiredSkills
                });
                relevantNodes = scoredNodes.map(sn => sn.node);
            } catch (error: any) {
                console.warn('[KnowledgeOrchestrator] Relevance scoring failed:', error.message);
            }
        }

        // Company research (if intent warrants it and JD has a company)
        let dossierContext = '';
        if (needsCompanyResearch(question) && this.activeJD) {
            const jd = this.activeJD.structured_data as StructuredJD;
            if (jd.company) {
                try {
                    const dossier = await this.companyResearch.researchCompany(
                        jd.company, jd.title, jd.location
                    );
                    dossierContext = formatDossierBlock(dossier);
                } catch (error: any) {
                    console.warn('[KnowledgeOrchestrator] Company research failed:', error.message);
                }
            }
        }

        // Pass everything to the Context Assembler for JIT prompt construction
        const result = await assemblePromptContext(
            question,
            this.activeResume,
            this.activeJD,
            relevantNodes.map(n => ({ node: n, score: 1 })),
            this.generateContentFn
        );

        // Append dossier context if available
        if (dossierContext && result) {
            result.contextBlock = result.contextBlock
                ? `${result.contextBlock}\n\n${dossierContext}`
                : dossierContext;
        }

        return result;
    }

    // ============================================
    // Management
    // ============================================

    deleteDocumentsByType(type: DocType): void {
        this.db.deleteDocumentsByType(type);
        if (type === DocType.RESUME) this.knowledgeModeActive = false;
        this.refreshCache();
    }

    private refreshCache(): void {
        this.activeResume = this.db.getDocumentByType(DocType.RESUME);
        this.activeJD = this.db.getDocumentByType(DocType.JD);
        this.cachedNodes = this.db.getAllNodes();
        console.log(`[KnowledgeOrchestrator] Cache refreshed: ${this.cachedNodes.length} total nodes across all docs`);
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
        return `${levelStr} ${jd.title} at ${jd.company}${jd.location ? ` (${jd.location})` : ''}. Tech: ${techFocus}. Themes: ${keyThemes}.`;
    }

    // Temporary helper for UI compatibility while refactoring
    getProfileData(): any {
        if (!this.activeResume) return null;
        try {
            const structured = this.activeResume.structured_data as StructuredResume;

            // JD data
            let jdData = null;
            if (this.activeJD) {
                const jd = this.activeJD.structured_data as StructuredJD;
                jdData = {
                    title: jd.title,
                    company: jd.company,
                    location: jd.location,
                    level: jd.level,
                    requirements: jd.requirements,
                    technologies: jd.technologies,
                    keywords: jd.keywords,
                    compensation_hint: jd.compensation_hint,
                    min_years_experience: jd.min_years_experience
                };
            }

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

                // Mock these since UI still expects them
                compactPersona: "Resume-Aware Mode Active",
                introShort: "Just-in-Time generation enabled",
                introInterview: "Just-in-Time generation enabled"
            };
        } catch {
            return null;
        }
    }
}

