// electron/llm/codeVerification/judge.ts
// Value comparison and result-set comparison for test case judging.

type CompareOpts = { orderInsensitive?: boolean };

const isObj = (v: any): v is Record<string, any> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const asFiniteNumber = (v: any): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^-?\d+(?:\.\d+)?$/.test(v.trim())) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

/** Deep equality with numeric coercion, optional order-insensitive arrays. */
export const valuesEqual = (a: any, b: any, opts: CompareOpts = {}): boolean => {
  if (a === b) return true;
  const an = asFiniteNumber(a);
  const bn = asFiniteNumber(b);
  if (an !== null && bn !== null) return an === bn;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    if (opts.orderInsensitive) {
      const used = new Array(b.length).fill(false);
      return a.every(av => {
        const idx = b.findIndex((bv, i) => !used[i] && valuesEqual(av, bv, opts));
        if (idx < 0) return false;
        used[idx] = true;
        return true;
      });
    }
    return a.every((av, i) => valuesEqual(av, b[i], opts));
  }
  if (isObj(a) && isObj(b)) {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    return ak.every(k => k in b && valuesEqual(a[k], b[k], opts));
  }
  if (typeof a === 'boolean' && typeof b === 'string') return String(a) === b.toLowerCase();
  if (typeof b === 'boolean' && typeof a === 'string') return String(b) === a.toLowerCase();
  return false;
};

/** Truncated JSON representation for error messages. */
export const renderValue = (v: any, max = 80): string => {
  let s: string;
  try {
    s = JSON.stringify(v);
  } catch {
    s = String(v);
  }
  if (s === undefined) s = 'undefined';
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
};

const rowsEqual = (a: Record<string, any>, b: Record<string, any>): boolean => {
  const ak = Object.keys(a).sort();
  const bk = Object.keys(b).sort();
  if (ak.length !== bk.length || !ak.every((k, i) => k === bk[i])) return false;
  return ak.every(k => valuesEqual(a[k], b[k]));
};

/** Compare SQL result sets (unordered by default). */
export const compareResultSet = (
  actual: Record<string, any>[],
  expected: Record<string, any>[],
  ordered = false,
): boolean => {
  if (!Array.isArray(actual) || !Array.isArray(expected)) return false;
  if (actual.length !== expected.length) return false;
  if (ordered) {
    return expected.every((row, i) => rowsEqual(actual[i], row));
  }
  const used = new Array(actual.length).fill(false);
  return expected.every(exp => {
    const idx = actual.findIndex((act, i) => !used[i] && rowsEqual(act, exp));
    if (idx < 0) return false;
    used[idx] = true;
    return true;
  });
};
