// electron/llm/codeVerification/sqlRunner.ts
// SQL verification: builds sqlite3 scripts, validates read-only queries,
// and parses JSON row output.

/** Check that a query is a read-only SELECT (or WITH…SELECT). */
export const isReadOnlySelect = (query: string | undefined | null): boolean => {
  if (!query || typeof query !== 'string') return false;
  const stripped = query.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ').trim();
  if (!stripped) return false;
  const withoutTrailing = stripped.replace(/;\s*$/, '');
  if (withoutTrailing.includes(';')) return false;
  const head = withoutTrailing.toLowerCase();
  const startsSelect = /^select\b/.test(head);
  const startsWith = /^with\b/.test(head);
  if (!startsSelect && !startsWith) return false;
  if (/\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum|reindex|truncate)\b/i.test(withoutTrailing)) {
    return false;
  }
  return true;
};

/** Build a sqlite3 script that creates schema, seeds data, then runs the query. */
export const buildSqlScript = (
  query: string,
  schema: string[],
  seeds: string[],
): string | null => {
  if (!isReadOnlySelect(query)) return null;
  if (!Array.isArray(schema) || schema.length === 0) return null;
  const stmt = (s: string) => s.trim().replace(/;\s*$/, '') + ';';
  const lines = ['.mode json', '.timeout 2000'];
  for (const s of schema) if (typeof s === 'string' && s.trim()) lines.push(stmt(s));
  for (const s of seeds || []) if (typeof s === 'string' && s.trim()) lines.push(stmt(s));
  lines.push(stmt(query));
  return lines.join('\n') + '\n';
};

/** Parse JSON row output from sqlite3. */
export const parseSqlRows = (stdout: string): { found: boolean; rows?: Record<string, any>[] } => {
  const t = (stdout || '').trim();
  if (t === '') return { found: true, rows: [] };
  const start = t.indexOf('[');
  const end = t.lastIndexOf(']');
  if (start < 0 || end <= start) return { found: false };
  try {
    const parsed = JSON.parse(t.slice(start, end + 1));
    if (!Array.isArray(parsed)) return { found: false };
    return { found: true, rows: parsed };
  } catch {
    return { found: false };
  }
};
