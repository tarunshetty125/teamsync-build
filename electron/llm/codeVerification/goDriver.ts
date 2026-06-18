// electron/llm/codeVerification/goDriver.ts
// Go program builder for code verification.

import { RESULT_SENTINEL_START, RESULT_SENTINEL_END } from './drivers';
import type { TestCase, ParsedSignature } from './types';

const canonicalType = (raw: string): string | null => {
  const t = raw.replace(/\s+/g, '');
  switch (t) {
    case 'int': return 'int'; case 'int64': return 'int64';
    case 'float64': case 'float32': return 'float64';
    case 'bool': return 'bool'; case 'string': return 'string';
    case '[]int': return 'sliceInt'; case '[][]int': return 'sliceSliceInt';
    case '[]string': return 'sliceString';
    case '*ListNode': return 'listnode'; case '*TreeNode': return 'treenode';
    default: return null;
  }
};

const isSlice = (t: string) => t === 'sliceInt' || t === 'sliceSliceInt' || t === 'sliceString';

export const parseGoSignature = (code: string, entry: string): ParsedSignature | null => {
  const m = code.match(new RegExp(`func\\s+${entry}\\s*\\(([^)]*)\\)\\s*([^{]*)\\{`));
  if (!m) return null;
  const paramsRaw = m[1].trim();
  const retRaw = m[2].trim();
  if (/^\(/.test(retRaw)) return null;
  const returnType = retRaw === '' ? null : canonicalType(retRaw);
  if (!returnType) return null;
  const params: string[] = [];
  if (paramsRaw) {
    const groups = splitParams(paramsRaw).map(s => s.trim()).filter(Boolean);
    const resolved: (string | null)[] = new Array(groups.length).fill(null);
    let pending: string | null = null;
    for (let i = groups.length - 1; i >= 0; i--) {
      const parts = groups[i].split(/\s+/);
      if (parts.length >= 2) {
        const typeTok = parts.slice(1).join('');
        const ct = canonicalType(typeTok);
        if (!ct) return null;
        resolved[i] = ct;
        pending = ct;
      } else {
        if (!pending) return null;
        resolved[i] = pending;
      }
    }
    for (const r of resolved) {
      if (!r) return null;
      params.push(r);
    }
  }
  return { returnType, params };
};

const splitParams = (s: string): string[] => {
  const out: string[] = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '[' || ch === '(') depth++; else if (ch === ']' || ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
};

const numArr = (x: any) => Array.isArray(x) && x.every((n: any) => typeof n === 'number');
const isIntOrNullArr = (x: any) => Array.isArray(x) && x.every((n: any) => n === null || (typeof n === 'number' && Number.isInteger(n)));

const goLiteral = (type: string, v: any): string | null => {
  switch (type) {
    case 'int': case 'int64': return typeof v === 'number' && Number.isInteger(v) ? String(v) : null;
    case 'float64': return typeof v === 'number' ? String(v) : null;
    case 'bool': return typeof v === 'boolean' ? String(v) : null;
    case 'string': return typeof v === 'string' ? goStr(v) : null;
    case 'sliceInt': return numArr(v) ? `[]int{${v.join(',')}}` : null;
    case 'sliceSliceInt': return Array.isArray(v) && v.every(numArr) ? `[][]int{${v.map((r: number[]) => `{${r.join(',')}}`).join(',')}}` : null;
    case 'sliceString': return Array.isArray(v) && v.every((s: any) => typeof s === 'string') ? `[]string{${v.map(goStr).join(',')}}` : null;
    case 'listnode': if (v === null) return '(*ListNode)(nil)'; return numArr(v) ? `__natBuildList([]int{${v.join(',')}})` : null;
    case 'treenode': if (v === null) return '(*TreeNode)(nil)'; return isIntOrNullArr(v) ? `__natBuildTree([]interface{}{${v.map((x: any) => x === null ? 'nil' : String(x)).join(',')}})` : null;
    default: return null;
  }
};

const goStr = (s: string) => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';

const goSerialize = (type: string, varName: string): string => {
  switch (type) {
    case 'listnode': return `__natEmitList(${varName})`;
    case 'treenode': return `__natEmitTree(${varName})`;
    case 'int': case 'int64': case 'float64': return `fmt.Print(${varName})`;
    case 'bool': return `if ${varName} { fmt.Print("true") } else { fmt.Print("false") }`;
    case 'string': return `__natEmitStr(${varName})`;
    case 'sliceInt': case 'sliceSliceInt': case 'sliceString': return `__natEmitJSON(${varName})`;
    default: return `fmt.Print("null")`;
  }
};

const structPreamble = (code: string, usesList: boolean, usesTree: boolean) => {
  const modelList = /type\s+ListNode\s+struct/.test(code);
  const modelTree = /type\s+TreeNode\s+struct/.test(code);
  const structs: string[] = [];
  const helpers: string[] = [];
  if (usesList) {
    if (!modelList) structs.push(`type ListNode struct { Val int; Next *ListNode }`);
    helpers.push(`func __natBuildList(a []int) *ListNode { d := &ListNode{}; t := d; for _, x := range a { t.Next = &ListNode{Val: x}; t = t.Next }; return d.Next }`);
    helpers.push(`func __natEmitList(h *ListNode) { fmt.Print("["); first := true; for h != nil { if !first { fmt.Print(",") }; fmt.Print(h.Val); first = false; h = h.Next }; fmt.Print("]") }`);
  }
  if (usesTree) {
    if (!modelTree) structs.push(`type TreeNode struct { Val int; Left *TreeNode; Right *TreeNode }`);
    helpers.push(`func __natBuildTree(a []interface{}) *TreeNode { if len(a) == 0 || a[0] == nil { return nil }; root := &TreeNode{Val: a[0].(int)}; q := []*TreeNode{root}; i := 1; for i < len(a) && len(q) > 0 { n := q[0]; q = q[1:]; if i < len(a) { if a[i] != nil { n.Left = &TreeNode{Val: a[i].(int)}; q = append(q, n.Left) }; i++ }; if i < len(a) { if a[i] != nil { n.Right = &TreeNode{Val: a[i].(int)}; q = append(q, n.Right) }; i++ } }; return root }`);
    helpers.push(`func __natEmitTree(root *TreeNode) { out := []string{}; q := []*TreeNode{}; if root != nil { q = append(q, root) }; for len(q) > 0 { n := q[0]; q = q[1:]; if n == nil { out = append(out, "null") } else { out = append(out, fmt.Sprintf("%d", n.Val)); q = append(q, n.Left); q = append(q, n.Right) } }; e := len(out); for e > 0 && out[e-1] == "null" { e-- }; fmt.Print("["); for k := 0; k < e; k++ { if k > 0 { fmt.Print(",") }; fmt.Print(out[k]) }; fmt.Print("]") }`);
  }
  return { structs: structs.join('\n'), helpers: helpers.join('\n') };
};

export const buildGoProgram = (code: string, entry: string, tc: TestCase): string | null => {
  const sig = parseGoSignature(code, entry);
  if (!sig) return null;
  const args = tc.input ?? [];
  if (args.length !== sig.params.length) return null;
  const decls: string[] = [];
  const callArgs: string[] = [];
  for (let i = 0; i < sig.params.length; i++) {
    const lit = goLiteral(sig.params[i], args[i]);
    if (lit === null) return null;
    decls.push(`\ta${i} := ${lit}`);
    callArgs.push(`a${i}`);
  }
  const usesList = sig.returnType === 'listnode' || sig.params.includes('listnode');
  const usesTree = sig.returnType === 'treenode' || sig.params.includes('treenode');
  const { structs, helpers } = structPreamble(code, usesList, usesTree);
  const retSlice = isSlice(sig.returnType);
  const retString = sig.returnType === 'string';
  const needsJSON = retSlice || retString;
  const emitters: string[] = [];
  if (retString) emitters.push(`func __natEmitStr(s string) { b, _ := json.Marshal(s); fmt.Print(string(b)) }`);
  if (retSlice) emitters.push(`func __natEmitJSON(v interface{}) {
\trv := v
\tswitch t := v.(type) {
\tcase []int:
\t\tif t == nil { rv = []int{} }
\tcase [][]int:
\t\tif t == nil { rv = [][]int{} }
\tcase []string:
\t\tif t == nil { rv = []string{} }
\t}
\tb, _ := json.Marshal(rv)
\tfmt.Print(string(b))
}`);
  return `package main

import (
\t"fmt"${needsJSON ? '\n\t"encoding/json"' : ''}
)

${structs}

${code}

${helpers}

${emitters.join('\n')}

func main() {
${decls.join('\n')}
\t__res := ${callArgs.length ? `${entry}(${callArgs.join(', ')})` : `${entry}()`}
\tfmt.Print("${RESULT_SENTINEL_START}")
\t${goSerialize(sig.returnType, '__res')}
\tfmt.Print("${RESULT_SENTINEL_END}")
}
`;
};
