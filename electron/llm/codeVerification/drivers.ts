// electron/llm/codeVerification/drivers.ts
// Test harness drivers for Python and JavaScript.
// Generates wrapper scripts that call the model's entry function,
// serialize the result between sentinels, and handle ListNode/TreeNode conversion.

import type { DriverInfo, DriverHints, TestCase } from './types';

/* ── Sentinels ────────────────────────────────────────────── */

export const RESULT_SENTINEL_START = '__NATIVELY_RESULT_START__';
export const RESULT_SENTINEL_END = '__NATIVELY_RESULT_END__';
export const TC_ENV = 'NATIVELY_TC';

/* ── Supported languages ──────────────────────────────────── */

export const LOCAL_LANGUAGES = ['python', 'javascript', 'cpp', 'java', 'go'];

export const isLocallyRunnable = (lang: string): boolean =>
  LOCAL_LANGUAGES.includes(lang);

export const isValidEntry = (entry: string): boolean =>
  /^[A-Za-z_$][\w$]*$/.test(entry);

/* ── Driver builder ───────────────────────────────────────── */

export const buildDriver = (
  language: string,
  code: string,
  entry: string,
  hints?: DriverHints,
): DriverInfo | null => {
  if (!isValidEntry(entry)) return null;
  switch (language) {
    case 'python':
      return { localCmd: 'python3', ext: 'py', source: pythonDriver(code, entry, hints) };
    case 'javascript':
      return { localCmd: 'node', ext: 'js', source: javascriptDriver(code, entry, hints) };
    default:
      return null;
  }
};

/* ── Helpers ──────────────────────────────────────────────── */

const hintsJson = (hints?: DriverHints): string =>
  JSON.stringify({ argTypes: hints?.argTypes ?? [], retType: hints?.retType ?? 'value' });

/* ── Python driver ────────────────────────────────────────── */

const pythonDriver = (code: string, entry: string, hints?: DriverHints): string =>
`import json, os, sys

# ---- model code (verbatim) ----
${code}
# ---- end model code ----

__HINTS = json.loads(${JSON.stringify(hintsJson(hints))})

# Define ListNode/TreeNode only if the model didn't (avoid clobbering its class).
if "ListNode" not in globals():
    class ListNode:
        def __init__(self, val=0, next=None):
            self.val = val; self.next = next
if "TreeNode" not in globals():
    class TreeNode:
        def __init__(self, val=0, left=None, right=None):
            self.val = val; self.left = left; self.right = right

def __nat_to_list(arr):
    if not arr: return None
    head = ListNode(arr[0]); t = head
    for x in arr[1:]:
        t.next = ListNode(x); t = t.next
    return head

def __nat_from_list(node):
    out = []
    while node is not None:
        out.append(node.val); node = node.next
    return out

def __nat_to_tree(arr):
    if not arr or arr[0] is None: return None
    from collections import deque
    root = TreeNode(arr[0]); q = deque([root]); i = 1
    while i < len(arr) and q:
        n = q.popleft()
        if i < len(arr):
            if arr[i] is not None: n.left = TreeNode(arr[i]); q.append(n.left)
            i += 1
        if i < len(arr):
            if arr[i] is not None: n.right = TreeNode(arr[i]); q.append(n.right)
            i += 1
    return root

def __nat_from_tree(root):
    from collections import deque
    out = []; q = deque([root]) if root else deque()
    while q:
        n = q.popleft()
        if n is None: out.append(None)
        else:
            out.append(n.val); q.append(n.left); q.append(n.right)
    while out and out[-1] is None: out.pop()
    return out

def __nat_decode(v, hint):
    if hint == "list": return __nat_to_list(v)
    if hint == "tree": return __nat_to_tree(v)
    return v

def __nat_encode(v, hint):
    if hint == "list": return __nat_from_list(v)
    if hint == "tree": return __nat_from_tree(v)
    return v

def __natively_main():
    raw = os.environ.get(${JSON.stringify(TC_ENV)}, "[]")
    args = json.loads(raw)
    arg_types = __HINTS.get("argTypes", [])
    args = [__nat_decode(a, arg_types[i] if i < len(arg_types) else "value") for i, a in enumerate(args)]
    fn = None
    if ${JSON.stringify(entry)} in globals():
        fn = globals()[${JSON.stringify(entry)}]
    elif "Solution" in globals():
        fn = getattr(Solution(), ${JSON.stringify(entry)}, None)
    if fn is None:
        sys.stderr.write("entry not found: ${entry}")
        sys.exit(3)
    result = fn(*args)
    result = __nat_encode(result, __HINTS.get("retType", "value"))
    sys.stdout.write(${JSON.stringify(RESULT_SENTINEL_START)} + json.dumps(result, allow_nan=False) + ${JSON.stringify(RESULT_SENTINEL_END)})

if __name__ == "__main__":
    __natively_main()
`;

/* ── JavaScript driver ────────────────────────────────────── */

const javascriptDriver = (code: string, entry: string, hints?: DriverHints): string =>
`'use strict';
if (typeof globalThis.ListNode === 'undefined') {
  globalThis.ListNode = function ListNode(val, next) { this.val = (val===undefined?0:val); this.next = (next===undefined?null:next); };
}
if (typeof globalThis.TreeNode === 'undefined') {
  globalThis.TreeNode = function TreeNode(val, left, right) { this.val = (val===undefined?0:val); this.left = (left===undefined?null:left); this.right = (right===undefined?null:right); };
}
// ---- model code (verbatim) ----
${code}
// ---- end model code ----

const __HINTS = JSON.parse(${JSON.stringify(hintsJson(hints))});
function __natToList(arr){ if(!arr||arr.length===0) return null; let head=new globalThis.ListNode(arr[0]),t=head; for(let i=1;i<arr.length;i++){t.next=new globalThis.ListNode(arr[i]);t=t.next;} return head; }
function __natFromList(node){ const out=[]; while(node!=null){out.push(node.val);node=node.next;} return out; }
function __natToTree(arr){ if(!arr||arr.length===0||arr[0]==null) return null; const root=new globalThis.TreeNode(arr[0]); const q=[root]; let i=1; while(i<arr.length&&q.length){ const n=q.shift(); if(i<arr.length){ if(arr[i]!=null){n.left=new globalThis.TreeNode(arr[i]);q.push(n.left);} i++; } if(i<arr.length){ if(arr[i]!=null){n.right=new globalThis.TreeNode(arr[i]);q.push(n.right);} i++; } } return root; }
function __natFromTree(root){ const out=[]; const q=root?[root]:[]; while(q.length){ const n=q.shift(); if(n==null)out.push(null); else {out.push(n.val);q.push(n.left);q.push(n.right);} } while(out.length&&out[out.length-1]==null)out.pop(); return out; }
function __natDecode(v,h){ return h==='list'?__natToList(v):h==='tree'?__natToTree(v):v; }
function __natEncode(v,h){ return h==='list'?__natFromList(v):h==='tree'?__natFromTree(v):v; }

(function __nativelyMain() {
  let args = JSON.parse(process.env[${JSON.stringify(TC_ENV)}] || '[]');
  const at = __HINTS.argTypes || [];
  args = args.map((a,i) => __natDecode(a, at[i] || 'value'));
  let fn = null;
  if (typeof ${entry} === 'function') {
    fn = ${entry};
  } else if (typeof Solution === 'function') {
    try { fn = (new Solution())[${JSON.stringify(entry)}].bind(new Solution()); } catch (e) { fn = null; }
  } else if (typeof module !== 'undefined' && module.exports && typeof module.exports[${JSON.stringify(entry)}] === 'function') {
    fn = module.exports[${JSON.stringify(entry)}];
  }
  if (typeof fn !== 'function') {
    process.stderr.write('entry not found: ${entry}');
    process.exit(3);
  }
  let result = fn(...args);
  result = __natEncode(result, __HINTS.retType || 'value');
  process.stdout.write(${JSON.stringify(RESULT_SENTINEL_START)} + JSON.stringify(result === undefined ? null : result) + ${JSON.stringify(RESULT_SENTINEL_END)});
})();
`;

/* ── Result parsing ───────────────────────────────────────── */

export const parseDriverResult = (stdout: string): { found: boolean; value?: any; raw?: string } => {
  const start = stdout.lastIndexOf(RESULT_SENTINEL_START);
  const end = stdout.lastIndexOf(RESULT_SENTINEL_END);
  if (start < 0 || end < 0 || end <= start) return { found: false };
  const raw = stdout.slice(start + RESULT_SENTINEL_START.length, end);
  try {
    return { found: true, value: JSON.parse(raw), raw };
  } catch {
    return { found: true, value: raw, raw };
  }
};

export const smokeCase = (): TestCase => ({ input: [], expected: undefined, source: 'smoke' });
