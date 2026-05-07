import { computeTokenDiff, DiffToken } from './differ';

const TREE_SITTER_BASE = 'https://cdn.jsdelivr.net/npm/web-tree-sitter@0.22.6';
const GRAMMAR_BASE = 'https://cdn.jsdelivr.net/gh/tree-sitter';

const GRAMMARS: Record<string, string> = {
  typescript: `${GRAMMAR_BASE}/tree-sitter-typescript@0.20.5/typescript/tree-sitter-typescript.wasm`,
  javascript: `${GRAMMAR_BASE}/tree-sitter-javascript@0.20.4/tree-sitter-javascript.wasm`,
  python: `${GRAMMAR_BASE}/tree-sitter-python@0.20.4/tree-sitter-python.wasm`,
  java: `${GRAMMAR_BASE}/tree-sitter-java@0.20.2/tree-sitter-java.wasm`,
  go: `${GRAMMAR_BASE}/tree-sitter-go@0.20.0/tree-sitter-go.wasm`,
  rust: `${GRAMMAR_BASE}/tree-sitter-rust@0.20.4/tree-sitter-rust.wasm`,
  c: `${GRAMMAR_BASE}/tree-sitter-c@0.20.6/tree-sitter-c.wasm`,
  cpp: `${GRAMMAR_BASE}/tree-sitter-cpp@0.20.3/tree-sitter-cpp.wasm`,
};

let TS: any = null;
const langCache = new Map<string, any>();

async function loadTreeSitter(): Promise<any> {
  if (TS) return TS;
  // Dynamically import the ESM bundle. Use Function() so the bundler does
  // not try to resolve the URL at build time.
  const importer = new Function('u', 'return import(u)') as (u: string) => Promise<any>;
  const mod = await importer(`${TREE_SITTER_BASE}/+esm`);
  const Parser = (mod as any).default ?? mod;
  await Parser.init({
    locateFile: (file: string) => `${TREE_SITTER_BASE}/${file}`,
  });
  TS = Parser;
  return TS;
}

async function loadLanguage(language: string): Promise<any | null> {
  if (langCache.has(language)) return langCache.get(language);
  const url = GRAMMARS[language];
  if (!url) return null;
  try {
    const Parser = await loadTreeSitter();
    const lang = await Parser.Language.load(url);
    langCache.set(language, lang);
    return lang;
  } catch (e) {
    console.warn('[forge] tree-sitter language load failed:', language, e);
    return null;
  }
}

export interface AstDiffOptions {
  fallbackToToken?: boolean;
}

export async function computeAstDiff(before: string, after: string, language: string, opts: AstDiffOptions = {}): Promise<DiffToken[]> {
  const lang = await loadLanguage(language);
  if (!lang) {
    return opts.fallbackToToken === false ? [] : computeTokenDiff(before, after);
  }
  const Parser = await loadTreeSitter();
  const parser = new Parser();
  parser.setLanguage(lang);
  const tBefore = parser.parse(before);
  const tAfter = parser.parse(after);

  // Bag-of-nodes comparison: collect named-node texts from each tree, then
  // diff the resulting token streams. This is intentionally simple — it gives
  // structural granularity (per AST node) without doing a full tree edit script.
  const nodesBefore = collectNamedNodes(tBefore.rootNode);
  const nodesAfter = collectNamedNodes(tAfter.rootNode);
  return diffNodeStreams(nodesBefore, nodesAfter);
}

function collectNamedNodes(node: any): string[] {
  const out: string[] = [];
  const visit = (n: any) => {
    if (n.namedChildCount === 0) {
      out.push(n.text);
    } else {
      for (let i = 0; i < n.namedChildCount; i++) visit(n.namedChild(i));
    }
  };
  visit(node);
  return out;
}

function diffNodeStreams(a: string[], b: string[]): DiffToken[] {
  const setA = new Set(a);
  const setB = new Set(b);
  const out: DiffToken[] = [];
  for (const t of a) {
    if (setB.has(t)) out.push({ type: 'equal', text: t, line: 0 });
    else out.push({ type: 'delete', text: t, line: 0 });
  }
  for (const t of b) {
    if (!setA.has(t)) out.push({ type: 'insert', text: t, line: 0 });
  }
  return out;
}
