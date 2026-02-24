// electron/knowledge/CompanyResearchEngine.ts
// Company research engine with pluggable web search, LLM summarization, and SQLite caching

import { CompanyDossier, SalaryEstimate } from './types';
import { KnowledgeDatabaseManager } from './KnowledgeDatabaseManager';

// ============================================
// Pluggable Search Provider Interface
// ============================================

export interface SearchResult {
    title: string;
    link: string;
    snippet: string;
}

export interface SearchProvider {
    search(query: string, numResults?: number): Promise<SearchResult[]>;
}

/**
 * Fetch text content from a URL with timeout and error handling.
 */
async function fetchPageText(url: string, timeoutMs: number = 5000): Promise<string> {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; NativelyBot/1.0)',
                'Accept': 'text/html,application/xhtml+xml'
            }
        });

        clearTimeout(timeout);

        if (!response.ok) return '';
        const html = await response.text();

        // Basic HTML to text extraction (strip tags, scripts, styles)
        return html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 3000); // Limit to 3k chars per page
    } catch {
        return '';
    }
}

// ============================================
// Dossier JSON schema for LLM prompt
// ============================================

const DOSSIER_SCHEMA = `{
  "company": "",
  "hiring_strategy": "",
  "interview_focus": "",
  "salary_estimates": [
    {"title": "", "location": "", "min": 0, "max": 0, "currency": "USD", "source": "", "confidence": "low"}
  ],
  "competitors": [],
  "recent_news": "",
  "sources": []
}`;

// ============================================
// Company Research Engine
// ============================================

export class CompanyResearchEngine {
    private db: KnowledgeDatabaseManager;
    private searchProvider: SearchProvider | null = null;
    private generateContentFn: ((contents: any[]) => Promise<string>) | null = null;

    // Rate limiting
    private lastSearchTime: number = 0;
    private minSearchIntervalMs: number = 2000; // 2 seconds between searches

    constructor(db: KnowledgeDatabaseManager) {
        this.db = db;
    }

    /**
     * Set the search provider (SerpAPI, Google Custom Search, etc.)
     */
    setSearchProvider(provider: SearchProvider): void {
        this.searchProvider = provider;
    }

    /**
     * Set the LLM content generation function.
     */
    setGenerateContentFn(fn: (contents: any[]) => Promise<string>): void {
        this.generateContentFn = fn;
    }

    /**
     * Research a company. Returns cached dossier if fresh, otherwise runs live research.
     */
    async researchCompany(
        companyName: string,
        role?: string,
        location?: string,
        forceRefresh: boolean = false
    ): Promise<CompanyDossier | null> {
        const normalizedName = companyName.toLowerCase().trim();
        console.log(`[CompanyResearch] Researching: ${companyName} (role: ${role}, location: ${location})`);

        // Check cache
        if (!forceRefresh) {
            const cached = this.db.getDossier(normalizedName);
            if (cached && !this.db.isDossierStale(normalizedName)) {
                console.log(`[CompanyResearch] Returning cached dossier for ${companyName}`);
                return cached.dossier as CompanyDossier;
            }
        }

        // If no search provider, return a minimal dossier with available data
        if (!this.searchProvider) {
            console.warn('[CompanyResearch] No search provider configured. Returning LLM-only dossier.');
            return this.generateLLMOnlyDossier(companyName, role, location);
        }

        // Rate limiting
        const now = Date.now();
        if (now - this.lastSearchTime < this.minSearchIntervalMs) {
            await new Promise(resolve => setTimeout(resolve, this.minSearchIntervalMs - (now - this.lastSearchTime)));
        }

        try {
            // Build search queries
            const queries = this.buildSearchQueries(companyName, role, location);
            const allResults: SearchResult[] = [];
            const allUrls: string[] = [];

            // Execute searches with rate limiting
            for (const query of queries) {
                try {
                    this.lastSearchTime = Date.now();
                    const results = await this.searchProvider.search(query, 3);
                    allResults.push(...results);
                    allUrls.push(...results.map(r => r.link));
                    // Small delay between queries
                    await new Promise(resolve => setTimeout(resolve, 500));
                } catch (error: any) {
                    console.warn(`[CompanyResearch] Search failed for query "${query}": ${error.message}`);
                }
            }

            if (allResults.length === 0) {
                console.warn('[CompanyResearch] No search results found. Falling back to LLM-only.');
                return this.generateLLMOnlyDossier(companyName, role, location);
            }

            // Fetch page content for top results (limit to 6)
            const snippets: { url: string; text: string }[] = [];
            for (const result of allResults.slice(0, 6)) {
                const text = result.snippet || await fetchPageText(result.link);
                if (text) {
                    snippets.push({ url: result.link, text: text.slice(0, 1500) });
                }
            }

            // Summarize with LLM
            const dossier = await this.summarizeWithLLM(companyName, role, location, snippets);

            if (dossier) {
                // Cache the dossier
                this.db.saveDossier(normalizedName, dossier, allUrls);
                return dossier;
            }

            return null;
        } catch (error: any) {
            console.error(`[CompanyResearch] Research failed for ${companyName}:`, error.message);
            return this.generateLLMOnlyDossier(companyName, role, location);
        }
    }

    /**
     * Build targeted search queries for a company.
     */
    private buildSearchQueries(companyName: string, role?: string, location?: string): string[] {
        const queries = [
            `${companyName} hiring strategy careers`,
            `${companyName} interview process ${role || ''}`.trim(),
        ];

        if (role && location) {
            queries.push(`${companyName} ${role} salary ${location}`);
        } else if (role) {
            queries.push(`${companyName} ${role} salary`);
        }

        queries.push(`${companyName} recent funding news layoffs`);
        queries.push(`${companyName} competitors`);

        return queries;
    }

    /**
     * Use LLM to summarize search snippets into a structured dossier.
     */
    private async summarizeWithLLM(
        companyName: string,
        role: string | undefined,
        location: string | undefined,
        snippets: { url: string; text: string }[]
    ): Promise<CompanyDossier | null> {
        if (!this.generateContentFn) return null;

        const snippetText = snippets.map(s => `[Source: ${s.url}]\n${s.text}`).join('\n\n---\n\n');

        const prompt = `You are a web research assistant. Using the following web snippets, create a structured company dossier JSON for ${companyName}${role ? ` focusing on the ${role} role` : ''}${location ? ` in ${location}` : ''}.

Match this exact JSON schema:
${DOSSIER_SCHEMA}

Rules:
- For each salary estimate, include a source URL and confidence level (low/medium/high).
- If information is not available, use empty strings or empty arrays.
- Do NOT fabricate data. Only use information from the snippets.
- Return JSON only. No markdown fences.

Web Snippets:
${snippetText}`;

        try {
            const response = await this.generateContentFn([{ text: prompt }]);
            let cleaned = response.trim();
            if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
            if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
            if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);

            const dossier = JSON.parse(cleaned.trim()) as CompanyDossier;
            dossier.fetched_at = new Date().toISOString();
            dossier.sources = [...new Set([...(dossier.sources || []), ...snippets.map(s => s.url)])];

            console.log(`[CompanyResearch] Dossier generated for ${companyName} with ${dossier.sources.length} sources`);
            return dossier;
        } catch (error: any) {
            console.error(`[CompanyResearch] Failed to parse LLM dossier response:`, error.message);
            return null;
        }
    }

    /**
     * Generate a minimal dossier using only LLM knowledge (no web search).
     */
    private async generateLLMOnlyDossier(
        companyName: string,
        role?: string,
        location?: string
    ): Promise<CompanyDossier | null> {
        if (!this.generateContentFn) return null;

        const prompt = `Based on your general knowledge, provide a brief company dossier for ${companyName}${role ? ` for the role of ${role}` : ''}${location ? ` in ${location}` : ''}.

Match this exact JSON schema:
${DOSSIER_SCHEMA}

Rules:
- Mark ALL confidence levels as "low" since this is from general knowledge, not live data.
- Use empty string for source URLs.
- Be conservative with salary estimates.
- Return JSON only. No markdown fences.`;

        try {
            const response = await this.generateContentFn([{ text: prompt }]);
            let cleaned = response.trim();
            if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
            if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
            if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);

            const dossier = JSON.parse(cleaned.trim()) as CompanyDossier;
            dossier.fetched_at = new Date().toISOString();
            dossier.sources = [];

            // Cache even LLM-only dossiers (shorter TTL could be set)
            this.db.saveDossier(companyName, dossier, []);

            console.log(`[CompanyResearch] LLM-only dossier generated for ${companyName} (low confidence)`);
            return dossier;
        } catch (error: any) {
            console.error(`[CompanyResearch] LLM-only dossier generation failed:`, error.message);
            return null;
        }
    }

    /**
     * Get cached dossier without triggering research.
     */
    getCachedDossier(companyName: string): CompanyDossier | null {
        const cached = this.db.getDossier(companyName);
        return cached ? cached.dossier as CompanyDossier : null;
    }
}
