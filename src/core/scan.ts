// Per-file source scanning: imports, tech debt markers, secrets and risky calls. No DOM or Node APIs.

import type { Flag, FileStat, DebtNote, Severity } from "./types";

const JS_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\(\s*)["']([^"'\n]+)["']/g;
const LANG_KIND: Record<string, string> = { JavaScript: "js", TypeScript: "js", Vue: "js", Svelte: "js", Astro: "js", Python: "py", Go: "go", Rust: "rs", C: "c", "C++": "c", Java: "jv", Kotlin: "jv", Scala: "jv", Ruby: "rb" };

export function importsOf(txt: string, lang: string): string[] {
  const kind = LANG_KIND[lang], out = new Set<string>();
  if (!kind) return [];
  if (kind === "js") for (const m of txt.matchAll(JS_IMPORT)) out.add("js:" + m[1]);
  if (kind === "py") for (const m of txt.matchAll(/^[ \t]*(?:from[ \t]+([.\w]+)[ \t]+import[ \t]+(\(?[^\n#]+)|import[ \t]+([\w., \t]+))/gm)) {
    if (m[1]) { out.add("py:" + m[1]); if (!m[2].startsWith("(")) m[2].split(",").forEach(n => { const x = n.trim().split(/\s/)[0]; if (/^\w+$/.test(x)) out.add("py:" + m[1] + (m[1].endsWith(".") ? "" : ".") + x); }); }
    else m[3].split(",").forEach(n => { const x = n.trim().split(/\s/)[0]; if (x) out.add("py:" + x); });
  }
  if (kind === "go") {
    for (const b of txt.matchAll(/^import\s*\(([\s\S]*?)^\)/gm)) for (const m of b[1].matchAll(/"([^"\n]+)"/g)) out.add("go:" + m[1]);
    for (const m of txt.matchAll(/^import\s+(?:\w+\s+)?"([^"\n]+)"/gm)) out.add("go:" + m[1]);
  }
  if (kind === "rs") {
    for (const m of txt.matchAll(/^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/gm)) out.add("rm:" + m[1]);
    for (const m of txt.matchAll(/^\s*(?:pub\s+)?use\s+crate::([\w:]+)/gm)) out.add("ru:" + m[1]);
  }
  if (kind === "c") for (const m of txt.matchAll(/^\s*#\s*include\s*"([^"\n]+)"/gm)) out.add("c:" + m[1]);
  if (kind === "jv") for (const m of txt.matchAll(/^\s*import\s+(?:static\s+)?([\w.]+)/gm)) out.add("jv:" + m[1]);
  if (kind === "rb") for (const m of txt.matchAll(/^\s*require_relative\s+["']([^"'\n]+)["']/gm)) out.add("js:./" + m[1].replace(/^\.\//, ""));
  return [...out];
}

const SECRETS: [string, RegExp, Severity][] = [
  ["Private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/, "CRITICAL"],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/, "CRITICAL"],
  ["GitHub token", /\b(?:ghp|gho|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/, "CRITICAL"],
  ["Stripe live key", /\b[sr]k_live_[0-9a-zA-Z]{20,}\b/, "CRITICAL"],
  ["Slack token", /\bxox[abprs]-[0-9A-Za-z-]{20,}\b/, "HIGH"],
  ["Google API key", /\bAIza[0-9A-Za-z_\-]{35}\b/, "HIGH"],
  ["Hardcoded credential", /\b(?:password|passwd|secret|api_?key|auth_?token|access_?token)\b["']?\s*[:=]\s*["']([^"'\s$<{]{12,})["']/i, "MODERATE"]
];
const RISKY: [string, RegExp, RegExp][] = [
  ["eval call", /\beval\s*\(/, /JavaScript|TypeScript|Python|PHP|Ruby/],
  ["Raw HTML injection", /\.innerHTML\s*=[^=]|dangerouslySetInnerHTML|v-html=/, /JavaScript|TypeScript|Vue/],
  ["Unsafe deserialization", /\bpickle\.loads?\(|\byaml\.load\((?![^)]*Loader)/, /Python/],
  ["Shell execution", /\bos\.system\(|shell\s*=\s*True|\bchild_process\b.*\bexec\(/, /Python|JavaScript|TypeScript/],
  ["Weak hash", /\b(?:md5|sha1)\s*\(|createHash\(\s*["'](?:md5|sha1)["']/i, /Python|JavaScript|TypeScript|PHP|Go/],
  ["SQL built with strings", /(?:execute|query)\s*\(\s*(?:f["']|["'`][^"'`]*(?:SELECT|INSERT|UPDATE|DELETE)\b[^"'`]*["'`]\s*\+)/i, /Python|JavaScript|TypeScript|PHP|Java/]
];
const EXAMPLE = /(^|\/)(tests?|__tests__|specs?|fixtures?|examples?|docs?|samples?|mocks?)\//i, PLACEHOLDER = /example|changeme|your[_-]|dummy|xxxx|test|fake|sample|placeholder|redacted/i;
const DEBT = /\b(TODO|FIXME|HACK|XXX)\b[:( ]?(.{0,110})/;
export const mask = (s: string) => s.length <= 8 ? "••••" : s.slice(0, 4) + "••••" + s.slice(-2);

// secrets are masked here, so the full value never reaches the report, exports or the page
export function scanText(path: string, txt: string, lang: string, isCode: boolean) {
  const debt: DebtNote[] = [], flags: Flag[] = [], sample = EXAMPLE.test(path);
  const lines = txt.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]; if (ln.length > 2000) continue;
    if (isCode) { const d = ln.match(DEBT); if (d) debt.push({ path, line: i + 1, tag: d[1], text: d[2].trim() }); }
    if (!sample) for (const [name, re, sev] of SECRETS) {
      const m = ln.match(re); if (!m) continue;
      const val = m[1] || m[0];
      if (name === "Hardcoded credential" && PLACEHOLDER.test(val)) continue;
      flags.push({ kind: "secret", name, severity: sev, path, line: i + 1, preview: name === "Private key" ? "PRIVATE KEY block" : mask(val) }); break;
    }
    if (isCode && !sample) for (const [name, re, langs] of RISKY) if (langs.test(lang) && re.test(ln) && !/^\s*(\/\/|#|\*)/.test(ln)) { flags.push({ kind: "code", name, severity: "LOW", path, line: i + 1, preview: "" }); break; }
  }
  return { debt, flags };
}

// file queries like: lang:python lines:>500 test:false src/
const FIELDS: Record<string, "lines" | "code" | "br" | "todo"> = { lines: "lines", code: "code", branches: "br", br: "br", todo: "todo" };
type F = Pick<FileStat, "path" | "lang" | "lines" | "test"> & Partial<FileStat>;
export function parseQuery(q: string) {
  const tests: ((f: F) => boolean)[] = [], words: string[] = [];
  for (const tok of q.toLowerCase().trim().split(/\s+/).filter(Boolean)) {
    const m = tok.match(/^(\w+):(.*)$/);
    if (!m) { words.push(tok); continue; }
    const [, k, v] = m;
    if (k === "lang") tests.push(f => f.lang.toLowerCase().includes(v));
    else if (k === "path") tests.push(f => f.path.toLowerCase().includes(v));
    else if (k === "test") tests.push(f => !!f.test === (v !== "false"));
    else if (FIELDS[k] || k === "imports") {
      const c = v.match(/^(>=|<=|>|<|=)?(\d+)$/); if (!c) continue;
      const n = +c[2], op = c[1] || ">=", get = (f: F) => k === "imports" ? (f.imports || []).length : f[FIELDS[k]] || 0;
      tests.push(f => { const x = get(f); return op === ">" ? x > n : op === "<" ? x < n : op === ">=" ? x >= n : op === "<=" ? x <= n : x === n; });
    } else words.push(tok);
  }
  return (f: F) => tests.every(t => t(f)) && words.every(w => f.path.toLowerCase().includes(w));
}
