import { ContextNode, DocType, KnowledgeDocument } from './types';
import { stableNodeKey } from './dedupeUtils';

export class KnowledgeDatabaseManager {
    private documents: KnowledgeDocument[] = [];
    private nodes: ContextNode[] = [];
    private gapAnalysis = new Map<number, any>();
    private negotiationScripts = new Map<number, any>();
    private mockQuestions = new Map<number, any>();
    private cultureMappings = new Map<number, any>();
    private nextId = 1;

    public constructor(_db?: any) {}

    public initializeSchema(): void {}

    public deleteDocumentsByType(type: DocType): void {
        const ids = new Set(this.documents.filter(doc => doc.type === type).map(doc => doc.id));
        this.documents = this.documents.filter(doc => doc.type !== type);
        this.nodes = this.nodes.filter(node => !ids.has(node.document_id));

        ids.forEach((id) => {
            if (typeof id === 'number') {
                this.gapAnalysis.delete(id);
                this.negotiationScripts.delete(id);
                this.mockQuestions.delete(id);
                this.cultureMappings.delete(id);
            }
        });
    }

    public clearAll(): void {
        this.documents = [];
        this.nodes = [];
        this.gapAnalysis.clear();
        this.negotiationScripts.clear();
        this.mockQuestions.clear();
        this.cultureMappings.clear();
        this.nextId = 1;
    }

    public saveDocument(doc: KnowledgeDocument): number {
        const id = this.nextId++;
        const stored: KnowledgeDocument = { ...doc, id };
        this.documents.push(stored);
        return id;
    }

    public saveNodes(nodes: ContextNode[], docId: number): void {
        // Normalize incoming nodes to ensure they reference the target document
        const normalized = nodes.map(node => ({ ...node, document_id: docId }));

        // Build set of stable keys for existing nodes for this document to avoid O(n^2) checks
        const existingKeys = new Set<string>(
            this.nodes
                .filter(n => n.document_id === docId)
                .map(n => stableNodeKey(n))
        );

        const toAdd: ContextNode[] = [];
        const seenInBatch = new Set<string>();
        for (const node of normalized) {
            const key = stableNodeKey(node);
            if (!key) {
                toAdd.push(node);
                continue;
            }
            if (existingKeys.has(key) || seenInBatch.has(key)) {
                continue;
            }
            seenInBatch.add(key);
            toAdd.push(node);
        }

        if (toAdd.length > 0) {
            this.nodes.push(...toAdd);
        }
    }

    public getDocumentByType(type: DocType): KnowledgeDocument | null {
        const docs = this.documents.filter(doc => doc.type === type);
        return docs.length > 0 ? docs[docs.length - 1] : null;
    }

    public getAllNodes(): ContextNode[] {
        return [...this.nodes];
    }

    public getNodeCount(type: DocType): number {
        return this.nodes.filter(node => node.source_type === type).length;
    }

    public getGapAnalysis(jdId: number): any | null {
        return this.gapAnalysis.get(jdId) ?? null;
    }

    public saveGapAnalysis(jdId: number, data: any): void {
        this.gapAnalysis.set(jdId, data);
    }

    public getNegotiationScript(jdId: number): any | null {
        return this.negotiationScripts.get(jdId) ?? null;
    }

    public saveNegotiationScript(jdId: number, script: any): void {
        this.negotiationScripts.set(jdId, script);
    }

    public getMockQuestions(jdId: number): any | null {
        return this.mockQuestions.get(jdId) ?? null;
    }

    public getCultureMappings(jdId: number): any | null {
        return this.cultureMappings.get(jdId) ?? null;
    }

    public saveCultureMappings(jdId: number, data: any): void {
        this.cultureMappings.set(jdId, data);
    }

    public saveMockQuestions(jdId: number, data: any): void {
        this.mockQuestions.set(jdId, data);
    }
}
