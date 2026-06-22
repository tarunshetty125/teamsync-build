import { ContextNode, DocType, KnowledgeDocument } from '../knowledge/types';
import { mergeAndDeduplicateResumeData } from '../knowledge/StructuredExtractor';
import { stableNodeKey } from '../knowledge/dedupeUtils';
import { mapToStructuredProjects, mapToStructuredEducation } from '../knowledge/structuredMappers';
import { PersistedResumeSnapshot, PersistenceService } from './PersistenceService';
import { LicenseService } from './LicenseService';

export class ResumeService {
    private static instance: ResumeService;

    private readonly licenseService: LicenseService;
    private readonly persistenceService: PersistenceService;

    private constructor() {
        this.licenseService = LicenseService.getInstance();
        this.persistenceService = PersistenceService.getInstance();
    }

    public static getInstance(): ResumeService {
        if (!ResumeService.instance) {
            ResumeService.instance = new ResumeService();
        }
        return ResumeService.instance;
    }

    public stageUploadedFile(filePath: string, type: DocType): string {
        if (!this.licenseService.isProActive()) return filePath;
        const prefix = type === DocType.JD ? 'jd' : 'resume';
        return this.persistenceService.stageUploadedFile(filePath, prefix);
    }

    public queuePersist(params: {
        resume?: KnowledgeDocument;
        jd?: KnowledgeDocument;
        resumeNodes: ContextNode[];
        jdNodes: ContextNode[];
        knowledgeModeActive: boolean;
    }): void {
        if (!this.licenseService.isProActive()) return;

        // Ensure merged/deduplicated projects + education are present in the structured resume
        let resumeForPersist = params.resume;
        try {
                if (resumeForPersist && resumeForPersist.structured_data) {
                const structured = resumeForPersist.structured_data as any;
                const merged = mergeAndDeduplicateResumeData(structured, undefined, undefined);
                const projects = mapToStructuredProjects(merged.projects);
                const education = mapToStructuredEducation(merged.education);

                resumeForPersist = { ...resumeForPersist, structured_data: { ...structured, projects, education } };
            }
        } catch (e) {
            // best-effort: fall back to original resume
            resumeForPersist = params.resume;
        }

        const payload: PersistedResumeSnapshot = {
            version: PersistenceService.getCacheVersion(),
            updatedAt: new Date().toISOString(),
            data: {
                resume: resumeForPersist,
                jd: params.jd,
                resumeNodes: params.resumeNodes,
                jdNodes: params.jdNodes,
                knowledgeModeActive: params.knowledgeModeActive,
            },
        };

        this.persistenceService.queueResumeSnapshot(payload);
    }

    public loadPersistedSnapshot(): PersistedResumeSnapshot | null {
        return this.persistenceService.loadResumeSnapshot();
    }

    public hydrateIntoDatabase(
        snapshot: PersistedResumeSnapshot,
        db: {
            saveDocument: (doc: KnowledgeDocument) => number;
            saveNodes: (nodes: ContextNode[], docId: number) => void;
        }
    ): { rehydratedJdId: number | null; knowledgeModeActive: boolean } {
        let rehydratedJdId: number | null = null;

        // Feature-detect optional DB methods to allow safe replace behavior
        const hasDeleteByType = typeof (db as any).deleteDocumentsByType === 'function';
        const hasGetDocument = typeof (db as any).getDocumentByType === 'function';
        const hasGetAllNodes = typeof (db as any).getAllNodes === 'function';

        // Helper to normalize string for deterministic matching
        const normalizeStr = (s?: string) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const makeKey = (n: ContextNode) => {
            try {
                return stableNodeKey(n) || '';
            } catch {
                return `${normalizeStr(n.title)}::${normalizeStr(n.text_content)}`;
            }
        };

        // Safely hydrate a single document type: try to clear previous state when possible.
        const hydrateType = (type: DocType, docData?: KnowledgeDocument, nodes?: ContextNode[]) => {
            if (!docData) return null;

            // Capture previous state so we can attempt restore on failure (best-effort)
            let prevDoc: KnowledgeDocument | null = null;
            let prevNodes: ContextNode[] = [];
            try {
                if (hasGetDocument && hasGetAllNodes) {
                    prevDoc = (db as any).getDocumentByType(type) || null;
                    if (prevDoc) {
                        prevNodes = (db as any).getAllNodes().filter((n: ContextNode) => n.document_id === prevDoc!.id) || [];
                    }
                }
            } catch (e) {
                // ignore read failures — we still try to hydrate
                prevDoc = null;
                prevNodes = [];
            }

            // If DB supports deletion by type, prefer clearing old docs first (replace semantics).
            if (hasDeleteByType) {
                try {
                    (db as any).deleteDocumentsByType(type);
                } catch (e) {
                    // ignore deletion failure and proceed (we'll still attempt to save)
                }
            }

            // If DB does not support delete by type, attempt to avoid node duplication by
            // filtering out incoming nodes that match existing nodes (best-effort dedupe).
            let nodesToSave = Array.isArray(nodes) ? [...nodes] : [];
            if (!hasDeleteByType && prevDoc && prevNodes.length > 0) {
                try {
                    const existingKeys = new Set(prevNodes.map(n => makeKey(n)));
                    nodesToSave = nodesToSave.filter(n => {
                        const k = makeKey(n);
                        return k && !existingKeys.has(k);
                    });
                } catch (e) {
                    // ignore dedupe errors
                }
            }

            // Now attempt to save the document and its nodes. If something fails, try to restore previous state.
            try {
                // Ensure merged/deduplicated projects + education are applied before saving to DB
                let docToSave = docData;
                try {
                    if (docData && (docData as any).structured_data) {
                        const structured = (docData as any).structured_data as any;
                        const merged = mergeAndDeduplicateResumeData(structured, undefined, undefined);
                            const projects = mapToStructuredProjects(merged.projects);
                            const education = mapToStructuredEducation(merged.education);
                            docToSave = { ...docData, structured_data: { ...structured, projects, education } };
                    }
                } catch (mergeErr) {
                    // best-effort: if merging fails, fall back to original docData
                    docToSave = docData;
                }

                const newId = db.saveDocument(docToSave);
                if (nodesToSave.length > 0) {
                    db.saveNodes(nodesToSave, newId);
                }
                return newId;
            } catch (saveErr) {
                // Attempt best-effort restore of previous state
                try {
                    if (prevDoc) {
                        const restoredId = db.saveDocument(prevDoc);
                        if (prevNodes.length > 0) {
                            db.saveNodes(prevNodes, restoredId);
                        }
                    }
                } catch (restoreErr) {
                    // swallow — nothing more we can do here
                }
                throw saveErr;
            }
        };

        // Hydrate resume (if included)
        if (snapshot.data.resume) {
            hydrateType(DocType.RESUME, snapshot.data.resume, snapshot.data.resumeNodes || []);
        }

        // Hydrate JD (if included) and capture its new id
        if (snapshot.data.jd) {
            const jdId = hydrateType(DocType.JD, snapshot.data.jd, snapshot.data.jdNodes || []);
            rehydratedJdId = jdId;
        }

        return {
            rehydratedJdId,
            knowledgeModeActive: Boolean(snapshot.data.knowledgeModeActive && snapshot.data.resume),
        };
    }
}
