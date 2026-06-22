import { ContextNode } from './types';
import { createHash } from 'crypto';

function normalizeForKey(s?: any): string {
    if (s == null) return '';
    return String(s)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// Lightweight, deterministic SHA-1 helper used for stable keys.
function djb2Hash(str: string): string {
    return createHash('sha1').update(String(str || ''), 'utf8').digest('hex');
}

// Node dedupe key: include category to avoid collisions across node-types,
// normalized title, and a content hash (SHA-1 of normalized text).
export function stableNodeKey(node: ContextNode): string {
    const sourceType = normalizeForKey(String((node as any).source_type || ''));
    const category = normalizeForKey((node as any).category || '');
    const title = normalizeForKey(node.title || '');
    const contentHash = djb2Hash(normalizeForKey(node.text_content || ''));
    // Include document/source type to avoid cross-document collisions
    const raw = `${sourceType}::${category}::${title}::${contentHash}`;
    return djb2Hash(raw);
}

// Projects: prefer title + technologies. Keep backward-compatible fallback to description.
export function stableProjectKey(p: { title?: string; description?: string; technologies?: string[] | string }): string {
    const title = normalizeForKey(p?.title || '');
    let techRaw = '';
    if (Array.isArray((p as any).technologies)) {
        techRaw = (p as any).technologies.join(',');
    } else if ((p as any).technologies) {
        techRaw = String((p as any).technologies);
    } else {
        techRaw = p?.description || '';
    }
    const tech = normalizeForKey(techRaw);
    return djb2Hash(`${title}::${tech}`);
}

// Education: canonical key = institution + degree + start_date (accept common field variants)
export function stableEducationKey(e: { institution?: string; degree?: string; startDate?: any; start_date?: any } ): string {
    const inst = normalizeForKey((e as any)?.institution || '');
    const degree = normalizeForKey((e as any)?.degree || '');
    const startVal = (e as any)?.start_date ?? (e as any)?.startDate ?? (e as any)?.start ?? '';
    const start = normalizeForKey(startVal || '');
    return djb2Hash(`${inst}::${degree}::${start}`);
}
