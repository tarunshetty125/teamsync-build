// premium/electron/knowledge/NativelySearchProvider.ts
// Search provider that routes through the Natively API /v1/search endpoint (Tavily-backed).
// Used when no Tavily API key is configured but a Natively key is present.

import { randomUUID } from 'crypto';
import { SearchProvider, SearchResult } from './CompanyResearchEngine';

export class NativelySearchProvider implements SearchProvider {
    private apiKey: string;
    private endpoint = 'https://api.natively.software/v1/search';
    // One UUID per instance = one UUID per company research button click.
    // The server bills 1 credit for the first query in a session; the rest are free.
    private sessionId: string = randomUUID();
    /** True if any search call was rejected with search_quota_exceeded (429). */
    public quotaExhausted = false;

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    async search(query: string, numResults: number = 5): Promise<SearchResult[]> {
        try {
            const response = await fetch(this.endpoint, {
                method: 'POST',
                headers: {
                    'x-natively-key': this.apiKey,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ query, depth: 'advanced', session_id: this.sessionId }),
                signal: AbortSignal.timeout(12000),
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                if (response.status === 429) {
                    this.quotaExhausted = true;
                    console.warn('[NativelySearch] Search quota exceeded — falling back to LLM-only research.');
                } else {
                    console.error(`[NativelySearch] Error ${response.status}: ${(err as any).error || 'unknown'}`);
                }
                return [];
            }

            const data = await response.json() as { results?: any[]; quota?: { remaining: number } };

            if (data.quota != null) {
                console.log(`[NativelySearch] Search quota remaining: ${data.quota.remaining}`);
            }

            const results: SearchResult[] = (data.results || []).slice(0, numResults).map((item: any) => ({
                title: item.title || '',
                link: item.url || '',
                snippet: item.content || '',
            }));

            console.log(`[NativelySearch] Got ${results.length} results for: "${query}"`);
            return results;
        } catch (error: any) {
            console.error(`[NativelySearch] Request failed: ${error.message}`);
            return [];
        }
    }
}
