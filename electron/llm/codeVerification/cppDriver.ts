// electron/llm/codeVerification/cppDriver.ts
// C++ program builder: parses function signatures, generates a main()
// that calls the entry function with test-case data and serializes the result.

import { RESULT_SENTINEL_START, RESULT_SENTINEL_END } from './drivers';
import type { TestCase, ParsedSignature } from './types';

/* ── C++ type declarations ────────────────────────────────── */

const CPP_DECL: Record<string, string> = {
  int: 'int', long: 'long', longlong: 'long long',
  double: 'double', bool: 'bool', string: 'std::string',
  vint: 'std::vector<int>', vvint: 'std::vector<std::vector<int>>',
  vstring: 'std::vector<std::string>', vbool: 'std::vector<bool>',
  listnode: 'ListNode*', treenode: 'TreeNode*',
};

const canonicalType = (raw: string): string | null => {
  const t = raw.replace(/\s+/g, ' ').replace(/[&*]/g, '').trim().replace(/\bconst\b/g, '').trim();
  const norm = t.replace(/\s+/g, '');
  switch (norm) {
    case 'int': return 'int';
    case 'long': return 'long';
    case 'longlong': case 'long long': return 'longlong';
    case 'double': case 'float': return 'double';
    case 'bool': return 'bool';
    case 'string': case 'std::string': return 'string';
    case 'vector<int>': case 'std::vector<int>': return 'vint';
    case 'vector<vector<int>>': case 'std::vector<std::vector<int>>': case 'vector<vector<int> >': return 'vvint';
    case 'vector<string>': case 'std::vector<std::string>': return 'vstring';
    case 'vector<bool>': case 'std::vector<bool>': return 'vbool';
    case 'ListNode': return 'listnode';
    case 'TreeNode': return 'treenode';
    default: return null;
  }
};

const isPointerStruct = (t: string) => t === 'listnode' || t === 'treenode';

export const parseCppSignature = (code: string, entry: string): ParsedSignature | null => {
  const idx = code.search(new RegExp(`\\b${entry}\\s*\\(`));
  if (idx < 0) return null;
  const before = code.slice(Math.max(0, idx - 100), idx).trim();
  const TYPE = String.raw`[A-Za-z_]\w*(?:::\w+)*(?:\s*<[^<>]*(?:<[^<>]*>[^<>]*)?> )?`;
  const rt = before.match(new RegExp(`(${TYPE})\\s*([*&]?)\\s*$`));
  if (!rt) return null;
  const returnType = canonicalType(rt[1]);
  if (!returnType) return null;
  if (rt[2] === '*' && !isPointerStruct(returnType)) return null;
  if (rt[2] !== '*' && isPointerStruct(returnType)) return null;
  const pm = code.slice(idx).match(/\(([^)]*)\)/);
  const paramsRaw = (pm ? pm[1] : '').trim();
  const params: string[] = [];
  if (paramsRaw) {
    for (const p of splitParams(paramsRaw)) {
      const stripped = p.trim().replace(/=.*$/, '').trim();
      const hasPtr = /\*/.test(stripped);
      const parts = stripped.replace(/\*/g, ' ').split(/\s+/).filter(Boolean);
      if (parts.length < 2) return null;
      const typeTok = parts.slice(0, -1).join(' ');
      const ct = canonicalType(typeTok);
      if (!ct) return null;
      if (hasPtr && !isPointerStruct(ct)) return null;
      if (!hasPtr && isPointerStruct(ct)) return null;
      params.push(ct);
    }
  }
  return { returnType, params };
};

const splitParams = (s: string): string[] => {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '<') depth++;
    else if (ch === '>') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
};

const isIntOrNullArr = (x: any): boolean =>
  Array.isArray(x) && x.every((n: any) => n === null || (typeof n === 'number' && Number.isInteger(n)));

const cppLiteral = (type: string, v: any): string | null => {
  const numArr = (x: any) => Array.isArray(x) && x.every((n: any) => typeof n === 'number');
  switch (type) {
    case 'listnode': if (v === null) return '(ListNode*)nullptr'; return numArr(v) ? `__nat_build_list({${v.join(',')}})` : null;
    case 'treenode': if (v === null) return '(TreeNode*)nullptr'; return isIntOrNullArr(v) ? `__nat_build_tree({${v.map((x: any) => x === null ? 'INT_MIN' : String(x)).join(',')}})` : null;
  }
  switch (type) {
    case 'int': case 'long': case 'longlong': return typeof v === 'number' && Number.isInteger(v) ? String(v) : null;
    case 'double': return typeof v === 'number' ? String(v) : null;
    case 'bool': return typeof v === 'boolean' ? String(v) : null;
    case 'string': return typeof v === 'string' ? cppStr(v) : null;
    case 'vint': return numArr(v) ? `{${v.join(',')}}` : null;
    case 'vbool': return Array.isArray(v) && v.every((b: any) => typeof b === 'boolean') ? `{${v.map(String).join(',')}}` : null;
    case 'vstring': return Array.isArray(v) && v.every((s: any) => typeof s === 'string') ? `{${v.map(cppStr).join(',')}}` : null;
    case 'vvint': return Array.isArray(v) && v.every(numArr) ? `{${v.map((row: number[]) => `{${row.join(',')}}`).join(',')}}` : null;
    default: return null;
  }
};

const cppStr = (s: string) => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';

const cppSerialize = (type: string, varName: string): string => {
  switch (type) {
    case 'listnode': return `__nat_emit_list(${varName});`;
    case 'treenode': return `__nat_emit_tree(${varName});`;
    case 'int': case 'long': case 'longlong': case 'double': return `std::cout << ${varName};`;
    case 'bool': return `std::cout << (${varName} ? "true" : "false");`;
    case 'string': return `__nat_emit_str(${varName});`;
    case 'vint': return `{ std::cout << "["; for (size_t i=0;i<${varName}.size();++i){ if(i)std::cout<<","; std::cout<<${varName}[i]; } std::cout << "]"; }`;
    case 'vbool': return `{ std::cout << "["; for (size_t i=0;i<${varName}.size();++i){ if(i)std::cout<<","; std::cout<<(${varName}[i]?"true":"false"); } std::cout << "]"; }`;
    case 'vstring': return `{ std::cout << "["; for (size_t i=0;i<${varName}.size();++i){ if(i)std::cout<<","; __nat_emit_str(${varName}[i]); } std::cout << "]"; }`;
    case 'vvint': return `{ std::cout << "["; for (size_t i=0;i<${varName}.size();++i){ if(i)std::cout<<","; std::cout<<"["; for(size_t j=0;j<${varName}[i].size();++j){ if(j)std::cout<<","; std::cout<<${varName}[i][j]; } std::cout<<"]"; } std::cout << "]"; }`;
    default: return `std::cout << "null";`;
  }
};

const pointerStructPreamble = (code: string, usesList: boolean, usesTree: boolean) => {
  const modelDefinesList = /struct\s+ListNode\b|class\s+ListNode\b/.test(code);
  const modelDefinesTree = /struct\s+TreeNode\b|class\s+TreeNode\b/.test(code);
  const structs: string[] = [];
  const helpers: string[] = [];
  if (usesList) {
    if (!modelDefinesList) structs.push(`struct ListNode { int val; ListNode* next; ListNode(int x): val(x), next(nullptr) {} };`);
    helpers.push(`static ListNode* __nat_build_list(const std::vector<int>& v){ ListNode dummy(0); ListNode* t=&dummy; for(int x: v){ t->next=new ListNode(x); t=t->next; } return dummy.next; }`);
    helpers.push(`static void __nat_emit_list(ListNode* h){ std::cout<<"["; bool f=true; while(h){ if(!f)std::cout<<","; std::cout<<h->val; f=false; h=h->next; } std::cout<<"]"; }`);
  }
  if (usesTree) {
    if (!modelDefinesTree) structs.push(`struct TreeNode { int val; TreeNode* left; TreeNode* right; TreeNode(int x): val(x), left(nullptr), right(nullptr) {} };`);
    helpers.push(`static TreeNode* __nat_build_tree(const std::vector<int>& v){ if(v.empty()||v[0]==INT_MIN) return nullptr; TreeNode* root=new TreeNode(v[0]); std::queue<TreeNode*> q; q.push(root); size_t i=1; while(i<v.size()&&!q.empty()){ TreeNode* n=q.front(); q.pop(); if(i<v.size()){ if(v[i]!=INT_MIN){ n->left=new TreeNode(v[i]); q.push(n->left);} i++; } if(i<v.size()){ if(v[i]!=INT_MIN){ n->right=new TreeNode(v[i]); q.push(n->right);} i++; } } return root; }`);
    helpers.push(`static void __nat_emit_tree(TreeNode* root){ std::vector<std::string> out; std::queue<TreeNode*> q; if(root)q.push(root); while(!q.empty()){ TreeNode* n=q.front(); q.pop(); if(n){ out.push_back(std::to_string(n->val)); q.push(n->left); q.push(n->right);} else out.push_back("null"); } while(!out.empty()&&out.back()=="null") out.pop_back(); std::cout<<"["; for(size_t i=0;i<out.size();++i){ if(i)std::cout<<","; std::cout<<out[i]; } std::cout<<"]"; }`);
  }
  return { structs: structs.join('\n'), helpers: helpers.join('\n') };
};

export const buildCppProgram = (code: string, entry: string, tc: TestCase): string | null => {
  const sig = parseCppSignature(code, entry);
  if (!sig) return null;
  const args = tc.input ?? [];
  if (args.length !== sig.params.length) return null;
  const decls: string[] = [];
  const callArgs: string[] = [];
  for (let i = 0; i < sig.params.length; i++) {
    const lit = cppLiteral(sig.params[i], args[i]);
    if (lit === null) return null;
    const decl = isPointerStruct(sig.params[i]) ? `    auto a${i} = ${lit};` : `    ${CPP_DECL[sig.params[i]]} a${i} = ${lit};`;
    decls.push(decl);
    callArgs.push(`a${i}`);
  }
  const usesList = sig.returnType === 'listnode' || sig.params.includes('listnode');
  const usesTree = sig.returnType === 'treenode' || sig.params.includes('treenode');
  const { structs, helpers } = pointerStructPreamble(code, usesList, usesTree);
  const isMethod = /class\s+Solution\b/.test(code);
  const callExpr = isMethod ? `Solution().${entry}(${callArgs.join(', ')})` : `${entry}(${callArgs.join(', ')})`;
  return `#include <iostream>
#include <vector>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <map>
#include <set>
#include <queue>
#include <stack>
#include <deque>
#include <list>
#include <array>
#include <tuple>
#include <bitset>
#include <functional>
#include <utility>
#include <algorithm>
#include <climits>
#include <cmath>
#include <numeric>
#include <sstream>
using namespace std;

${structs}
${code}
${helpers}

static void __nat_emit_str(const std::string& s){ std::cout << '"'; for(char c: s){ if(c=='"'||c=='\\\\') std::cout<<'\\\\'; std::cout<<c; } std::cout << '"'; }

int main(){
${decls.join('\n')}
    auto __res = ${callExpr};
    std::cout << "${RESULT_SENTINEL_START}";
    ${cppSerialize(sig.returnType, '__res')}
    std::cout << "${RESULT_SENTINEL_END}";
    return 0;
}
`;
};
