import { CompanyResearchEngine, JDContext } from '../knowledge/CompanyResearchEngine';
import type { AOTInputIdentity } from '../knowledge/KnowledgeDatabaseManager';
import { CompanyInsights, CompanyIntelligenceMapper } from './CompanyIntelligenceMapper';
export type { CompanyInsights } from './CompanyIntelligenceMapper';

type CacheEntry = {
  insights: CompanyInsights;
  fetchedAt: number;
};

function normalizeKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function createCacheKey(companyName: string, role: string, inputIdentity?: AOTInputIdentity | null): string {
  return `${normalizeKeyPart(companyName)}::${normalizeKeyPart(role || 'general')}::${inputIdentity?.pairFingerprint || 'company'}`;
}

export class TavilyService {
  private cache = new Map<string, CacheEntry>();
  private inFlight = new Map<string, Promise<CompanyInsights | null>>();
  private cacheVersion = 0;
  private mapper = new CompanyIntelligenceMapper();

  constructor(private companyResearch: CompanyResearchEngine) {}

  setGenerateContentFn(fn: ((contents: any[]) => Promise<string>) | null): void {
    this.mapper.setGenerateContentFn(fn);
  }

  hasInFlight(companyName: string, role: string, inputIdentity?: AOTInputIdentity | null): boolean {
    return this.inFlight.has(createCacheKey(companyName, role, inputIdentity));
  }

  clearCache(options: { dropInFlight?: boolean } = {}): void {
    this.cache.clear();
    this.cacheVersion++;
    if (options.dropInFlight) {
      this.inFlight.clear();
    }
  }

  getCachedInsights(
    companyName: string,
    role: string,
    jdCtx: JDContext = {},
    inputIdentity?: AOTInputIdentity | null
  ): CompanyInsights | null {
    const cacheKey = createCacheKey(companyName, role, inputIdentity);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached.insights;
    }

    const dossier = this.companyResearch.getCachedDossier(companyName, inputIdentity);
    if (!dossier) {
      return null;
    }

    const insights = this.mapper.mapDeterministic({
      companyName,
      role,
      dossier,
      jdCtx,
    });
    this.cache.set(cacheKey, { insights, fetchedAt: Date.now() });
    return insights;
  }

  async fetchCompanyInsights(
    companyName: string,
    role: string,
    jdCtx: JDContext = {},
    options: { forceRefresh?: boolean; shouldContinue?: () => boolean; inputIdentity?: AOTInputIdentity | null } = {}
  ): Promise<CompanyInsights | null> {
    const inputIdentity = options.inputIdentity ?? null;
    const cacheKey = createCacheKey(companyName, role, inputIdentity);
    const shouldContinue = options.shouldContinue ?? (() => true);
    const cacheVersionSnapshot = this.cacheVersion;

    if (!options.forceRefresh) {
      const cached = this.getCachedInsights(companyName, role, jdCtx, inputIdentity);
      if (cached) {
        return cached;
      }

      const pending = this.inFlight.get(cacheKey);
      if (pending) {
        return pending;
      }
    }

    const task = (async () => {
      const dossier = await this.companyResearch.researchCompany(
        companyName,
        jdCtx,
        !!options.forceRefresh,
        shouldContinue,
        inputIdentity
      );
      if (!shouldContinue()) {
        return null;
      }
      if (!dossier) {
        return null;
      }

      const insights = await this.mapper.map({
        companyName,
        role,
        dossier,
        jdCtx,
      });
      if (!shouldContinue() || cacheVersionSnapshot !== this.cacheVersion) {
        return null;
      }
      this.cache.set(cacheKey, { insights, fetchedAt: Date.now() });
      return insights;
    })();

    this.inFlight.set(cacheKey, task);

    try {
      return await task;
    } finally {
      this.inFlight.delete(cacheKey);
    }
  }
}
