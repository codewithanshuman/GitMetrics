// Line counting and manifest parsing. Shared by the web app and the CLI, so it must stay free of DOM and Node APIs.
import { importsOf, scanText } from "./scan";
import type { CountResult, DepManifest, Entry, FileStat, LangDef, LangTotals } from "./types";

// language table: name, extensions, line comment, then block comment start/end pairs
const L: Record<string, LangDef> = {};
const add = (n: string, exts: string, lc?: string, ...blocks: string[]) => exts.split(" ").forEach(e => L[e] = [n, lc || "", ...blocks]);
const C = ["/*", "*/"], X = ["<!--", "-->"];
add("JavaScript", "js mjs cjs jsx", "//", ...C); add("TypeScript", "ts tsx mts cts", "//", ...C);
add("Python", "py pyi", "#", '"""', '"""', "'''", "'''"); add("Ruby", "rb", "#", "=begin", "=end"); add("Shell", "sh bash zsh fish", "#");
add("PowerShell", "ps1 psm1", "#", "<#", "#>"); add("Batch", "bat cmd", "::");
add("Java", "java", "//", ...C); add("Kotlin", "kt kts", "//", ...C); add("Groovy", "groovy gradle", "//", ...C);
add("C", "c h", "//", ...C); add("C++", "cpp cc cxx hpp hh", "//", ...C); add("Objective-C", "m mm", "//", ...C);
add("C#", "cs", "//", ...C); add("F#", "fs fsx", "//", "(*", "*)"); add("Go", "go", "//", ...C); add("Rust", "rs", "//", ...C);
add("Swift", "swift", "//", ...C); add("Scala", "scala", "//", ...C); add("Dart", "dart", "//", ...C); add("Zig", "zig", "//");
add("PHP", "php", "//", ...C); add("CSS", "css", "", ...C); add("SCSS", "scss less", "//", ...C); add("Solidity", "sol", "//", ...C);
add("HTML", "html htm", "", ...X); add("Vue", "vue", "", ...X); add("Svelte", "svelte", "", ...X); add("Astro", "astro", "", ...X); add("XML", "xml svg", "", ...X);
add("YAML", "yml yaml", "#"); add("TOML", "toml", "#"); add("HCL", "tf hcl", "#", ...C); add("SQL", "sql", "--", ...C); add("GraphQL", "graphql gql", "#"); add("Protobuf", "proto", "//", ...C);
add("Lua", "lua", "--", "--[[", "]]"); add("Haskell", "hs", "--", "{-", "-}"); add("R", "r", "#"); add("Perl", "pl pm", "#"); add("Julia", "jl", "#", "#=", "=#");
add("Elixir", "ex exs", "#"); add("Erlang", "erl hrl", "%"); add("Clojure", "clj cljs cljc", ";"); add("Nim", "nim", "#", "#[", "]#"); add("OCaml", "ml mli", "", "(*", "*)");
add("Dockerfile", "dockerfile", "#"); add("Makefile", "makefile mk", "#"); add("CMake", "cmake", "#");
add("Jupyter Notebook", "ipynb", "#"); add("Markdown", "md mdx"); add("reStructuredText", "rst"); add("JSON", "json jsonc"); add("Text", "txt");

export const OTHER: LangDef = ["Other", ""];
export const BIN = new Set("png jpg jpeg gif webp avif ico bmp tiff pdf zip gz tgz bz2 xz 7z rar woff woff2 ttf otf eot mp3 wav ogg flac mp4 mov avi mkv webm wasm jar so dll dylib exe bin class pyc o a psd ai sketch fig blend pt onnx parquet sqlite db".split(" "));
export const SKIPDIR = new Set(["node_modules", ".git", "dist", "build", "out", "vendor", "__pycache__", ".next", "third_party", "Pods"]);
export const VENDOR = /(^|\/)(node_modules|vendor|dist|build|out|\.git|__pycache__|\.next|third_party|Pods)\//;
export const GENERATED = /(package-lock\.json|pnpm-lock\.yaml|\.lock|go\.sum|\.min\.(js|css))$/;
export const GEN_MARK = /@generated|DO NOT EDIT|auto-?generated|Code generated/i;
export const NONCODE = new Set(["Markdown", "reStructuredText", "JSON", "Text", "YAML", "TOML", "XML", "Other"]);
const MAX_BYTES = 5e6;

export const extOf = (fname: string) => fname.includes(".") ? fname.split(".").pop()! : fname;
export const langOf = (name: string): LangDef => { const f = name.toLowerCase(); return L[extOf(f)] || OTHER; };
export const isTest = (p: string) => /(^|\/)(tests?|__tests__|specs?)\//i.test(p) || /\.(test|spec)\.[a-z]+$/i.test(p) || /(_test\.(go|py)|(^|\/)test_[^/]+\.py)$/.test(p);
export const branches = (txt: string) => (txt.match(/\b(if|for|while|case|catch|elif|except)\b|&&|\|\|/g) || []).length;

export function tally(text: string, def: LangDef | string[]) {
  const [, lc, ...bl] = def;
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  let code = 0, com = 0, blank = 0, end = "";
  // text after a closing delimiter is real code, as in `/* note */ run();`
  const closed = (rest: string) => { if (rest && !(lc && rest.startsWith(lc))) code++; else com++; };
  for (const raw of lines) {
    const s = raw.trim();
    if (!s) { blank++; continue; }
    if (end) {
      const at = s.indexOf(end);
      if (at < 0) { com++; continue; }
      closed(s.slice(at + end.length).trim()); end = ""; continue;
    }
    let open = -1;
    for (let i = 0; i < bl.length; i += 2) if (s.startsWith(bl[i])) { open = i; break; }
    if (open >= 0) {
      const at = s.indexOf(bl[open + 1], bl[open].length);
      if (at < 0) { com++; end = bl[open + 1]; } else closed(s.slice(at + bl[open + 1].length).trim());
      continue;
    }
    if (lc && s.startsWith(lc)) { com++; continue; }
    code++;
  }
  return { code, com, blank };
}

// last matching rule wins, so `!keep.log` can re-include a file
export function gitignore(t: string) {
  const rules = t.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#")).map(l => {
    const neg = l.startsWith("!"); if (neg) l = l.slice(1);
    const dir = l.endsWith("/"); let p = l.replace(/\/$/, ""); const anch = p.includes("/"); p = p.replace(/^\//, "");
    const r = p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\u0000/g, ".*");
    return [new RegExp((anch ? "^" : "(^|/)") + r + (dir ? "/" : "(/|$)")), neg] as const;
  });
  return (p: string) => { let hit = false; for (const [re, neg] of rules) if (re.test(p)) hit = !neg; return hit; };
}

const bare = (v: unknown) => String(v ?? "").replace(/^[^\d]*/, "").split(/[\s,|]/)[0];
type Pin = [string, string | undefined];
const dep = (ecosystem: string, kind: string, entries: Pin[], exact: boolean): Omit<DepManifest, "file"> => ({ ecosystem, kind, exact, names: [...new Set(entries.map(e => e[0]))], vers: Object.fromEntries(entries.filter(e => e[1]).map(([n, v]) => [n, v as string])) });

export function parseDeps(name: string, t: string): Omit<DepManifest, "file"> | null {
  try {
    if (name === "package.json") { const j = JSON.parse(t); return dep("npm", "npm", (Object.entries({ ...(j.devDependencies || {}), ...(j.dependencies || {}) }) as [string, string][]).map(([n, v]): Pin => [n, /^[\^~>=v\d]/.test(v) ? bare(v) : ""]), false); }
    if (name === "requirements.txt") return dep("PyPI", "pip", t.split("\n").map(l => l.trim()).filter(l => l && !/^[#-]/.test(l)).map((l): Pin | null => { const m = l.match(/^([\w.\-]+)(?:\[[^\]]*\])?\s*(==|>=|~=)?\s*([\w.\-]+)?/); return m ? [m[1], m[2] ? m[3] : ""] : null; }).filter((x): x is Pin => !!x), false);
    if (name === "go.mod") return dep("Go", "go", [...t.matchAll(/^\s*(?:require\s+)?([\w.\-]+\.[\w.\-]+\/[^\s]+)\s+v([\w.\-+]+)/gm)].map((x): Pin => [x[1], x[2]]), true);
    if (name === "cargo.toml") { const sec = t.split(/^\[(?:dev-|build-)?dependencies\]/m).slice(1).map(x => x.split(/^\[/m)[0]).join("\n"); return dep("crates.io", "cargo", [...sec.matchAll(/^([\w\-]+)\s*=\s*(?:"([^"]+)"|\{[^}]*version\s*=\s*"([^"]+)")?/gm)].map((x): Pin => [x[1], bare(x[2] || x[3])]), false); }
    if (name === "gemfile") return dep("RubyGems", "gem", [...t.matchAll(/^\s*gem\s+["']([^"']+)["'](?:\s*,\s*["'][~>=\s]*([\d.]+))?/gm)].map((x): Pin => [x[1], x[2] || ""]), false);
    if (name === "package-lock.json") { const j = JSON.parse(t); const list = j.packages ? Object.entries(j.packages).filter(([p]) => p.includes("node_modules/")).map(([p, v]: [string, any]): Pin => [p.split("node_modules/").pop()!, v.version]) : Object.entries(j.dependencies || {}).map(([n, v]: [string, any]): Pin => [n, v.version]); return dep("npm", "npm lock", list, true); }
    if (name === "cargo.lock" || name === "poetry.lock" || name === "uv.lock") return dep(name === "cargo.lock" ? "crates.io" : "PyPI", name.replace(".lock", " lock"), [...t.matchAll(/\[\[package\]\]\s*\nname = "([^"]+)"\s*\nversion = "([^"]+)"/g)].map((x): Pin => [x[1], x[2]]), true);
    if (name === "gemfile.lock") return dep("RubyGems", "gem lock", [...t.matchAll(/^ {4}([\w.\-]+) \(([\d][^)\s]*)\)$/gm)].map((x): Pin => [x[1], x[2]]), true);
  } catch {}
  return null;
}
const MANIFESTS = new Set(["package.json", "requirements.txt", "go.mod", "cargo.toml", "gemfile"]);
const LOCKS = new Set(["package-lock.json", "cargo.lock", "poetry.lock", "uv.lock", "gemfile.lock"]);

export function cocomo(code: number) {
  const eff = 2.4 * Math.pow(code / 1000, 1.05), months = 2.5 * Math.pow(eff, 0.38);
  return { personMonths: +eff.toFixed(1), months: +months.toFixed(1), people: months ? +(eff / months).toFixed(1) : 0, cost: Math.round(eff / 12 * 56286 * 1.8) };
}

const tick = () => new Promise(r => setTimeout(r));

// entries: [path, {size, async: () => Uint8Array}]. Files are read lazily, so skipped ones cost nothing.
interface CountOptions { vendor?: boolean; concurrency?: number; signal?: AbortSignal; onProgress?: (done: number, all: number) => void }
export async function countEntries(entries: Entry[], { vendor = false, concurrency = 8, signal, onProgress }: CountOptions = {}): Promise<CountResult> {
  const langs: Record<string, LangTotals> = {}, files: FileStat[] = [], deps: DepManifest[] = [], dupMap = new Map<string, number>(), debt: CountResult["debt"] = [], flags: CountResult["flags"] = [];
  let dupTotal = 0, skipped = 0, binary = 0, failed = 0, done = 0, idx = 0;
  const dec = new TextDecoder("utf-8");
  let ign: ((p: string) => boolean) | null = null; const gi = entries.find(e => e[0] === ".gitignore");
  if (gi && !vendor) { try { ign = gitignore(dec.decode(await gi[1].async("uint8array"))); } catch {} }
  const addDeps = (name: string, path: string, txt: string) => { const d = parseDeps(name, txt); if (d && d.names.length) deps.push({ file: path, ...d }); };
  const handle = async ([path, ent]: Entry) => {
    const fname = path.split("/").pop()!.toLowerCase(), ext = extOf(fname);
    const ignored = !vendor && (VENDOR.test(path) || GENERATED.test(path) || (ign && ign(path)));
    if (ignored) {
      // lock files aren't counted as lines, but they hold the exact versions the vulnerability scan needs
      if (LOCKS.has(fname) && !VENDOR.test(path)) { try { addDeps(fname, path, dec.decode(await ent.async("uint8array"))); } catch {} }
      skipped++; return;
    }
    if (BIN.has(ext) || ent.size > MAX_BYTES) { binary++; return; }
    let buf: Uint8Array; try { buf = await ent.async("uint8array"); } catch { failed++; return; }
    if (buf.length > MAX_BYTES || buf.subarray(0, 8000).includes(0)) { binary++; return; }
    const def = langOf(fname);
    let txt = dec.decode(buf);
    if (ext === "ipynb") { try { txt = JSON.parse(txt).cells.filter((c: any) => c.cell_type === "code").map((c: any) => ([] as string[]).concat(c.source).join("")).join("\n"); } catch {} }
    if (!vendor && GEN_MARK.test(txt.slice(0, 400))) { skipped++; return; }
    if (MANIFESTS.has(fname) || LOCKS.has(fname)) addDeps(fname, path, txt);
    const t = tally(txt, def), isCode = !NONCODE.has(def[0]);
    // tests repeat setup lines on purpose, so they would inflate the figure
    if (isCode && !isTest(path)) for (const ln of txt.split("\n")) { const k = ln.trim(); if (k.length >= 25 && /\w/.test(k) && dupMap.size < 400000) { dupMap.set(k, (dupMap.get(k) || 0) + 1); dupTotal++; } }
    const g = langs[def[0]] ||= { name: def[0], files: 0, code: 0, com: 0, blank: 0 };
    g.files++; g.code += t.code; g.com += t.com; g.blank += t.blank;
    const sc = scanText(path, txt, def[0], isCode);
    debt.push(...sc.debt); flags.push(...sc.flags);
    files.push({ path, lang: def[0], lines: t.code + t.com + t.blank, code: t.code, com: t.com, test: isTest(path), br: isCode ? branches(txt) : 0, todo: sc.debt.length, imports: isCode ? importsOf(txt, def[0]) : [] });
  };
  const worker = async () => {
    while (idx < entries.length && !(signal && signal.aborted)) {
      await handle(entries[idx++]);
      if (++done % 25 === 0) { onProgress && onProgress(done, entries.length); await tick(); }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  if (signal && signal.aborted) throw new DOMException("Cancelled", "AbortError");
  if (!files.length) throw new Error("No countable text files were found" + (failed ? " (" + failed + " files couldn’t be fetched)." : "."));
  let dup = 0; for (const c of dupMap.values()) if (c > 1) dup += c;
  return { langs, files, deps, debt, flags, skipped, binary, failed, dup: dupTotal ? dup / dupTotal : null };
}
