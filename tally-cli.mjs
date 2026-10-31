#!/usr/bin/env node
// Tally CLI: count code, comments and blanks in a folder or GitHub repo. Node 18+, no dependencies.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const argv = process.argv.slice(2);
const has = f => argv.includes(f);
const val = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const target = argv.find((a, i) => !a.startsWith("-") && argv[i - 1] !== "--diff") || ".";
if (has("-h") || has("--help")) {
  console.log(`Tally CLI
Usage: node tally-cli.mjs [folder | owner/repo[@branch] | github-url] [options]
  --json            print JSON
  --markdown        print a Markdown report
  --csv             print cloc-style CSV (files,language,blank,comment,code)
  --diff <folder>   compare against another folder (for example the base of a pull request)
  --all             include vendored, generated and lock files`);
  process.exit(0);
}

const L = {};
const add = (n, exts, lc, bs, be) => exts.split(" ").forEach(e => L[e] = [n, lc || "", bs || "", be || ""]);
add("JavaScript", "js mjs cjs jsx", "//", "/*", "*/"); add("TypeScript", "ts tsx mts cts", "//", "/*", "*/");
add("Python", "py pyi", "#", '"""', '"""'); add("Ruby", "rb", "#"); add("Shell", "sh bash zsh", "#");
add("Java", "java", "//", "/*", "*/"); add("Kotlin", "kt kts", "//", "/*", "*/");
add("C", "c h", "//", "/*", "*/"); add("C++", "cpp cc cxx hpp hh", "//", "/*", "*/");
add("C#", "cs", "//", "/*", "*/"); add("Go", "go", "//", "/*", "*/"); add("Rust", "rs", "//", "/*", "*/");
add("Swift", "swift", "//", "/*", "*/"); add("Scala", "scala", "//", "/*", "*/"); add("Dart", "dart", "//", "/*", "*/");
add("PHP", "php", "//", "/*", "*/"); add("CSS", "css", "", "/*", "*/"); add("SCSS", "scss less", "//", "/*", "*/");
add("HTML", "html htm", "", "<!--", "-->"); add("Vue", "vue svelte", "", "<!--", "-->"); add("XML", "xml svg", "", "<!--", "-->");
add("YAML", "yml yaml", "#"); add("TOML", "toml", "#"); add("SQL", "sql", "--"); add("Lua", "lua", "--");
add("Haskell", "hs", "--"); add("R", "r", "#"); add("Perl", "pl pm", "#");
add("Dockerfile", "dockerfile", "#"); add("Makefile", "makefile mk", "#");
add("Markdown", "md mdx"); add("JSON", "json jsonc"); add("Text", "txt rst");
const BIN = new Set("png jpg jpeg gif webp ico bmp pdf zip gz tgz bz2 7z rar woff woff2 ttf otf eot mp3 mp4 mov avi webm wasm jar so dll dylib exe bin class pyc o a psd".split(" "));
const SKIPDIR = new Set(["node_modules", ".git", "dist", "build", "out", "vendor", "__pycache__", ".next", "third_party", "Pods"]);
const GEN = /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|composer\.lock|Gemfile\.lock|\.min\.(js|css))$/;
const NONCODE = new Set(["Markdown", "JSON", "Text", "YAML", "TOML", "XML", "Other"]);
const isTest = p => /(^|\/)(tests?|__tests__|specs?)\//i.test(p) || /\.(test|spec)\.[a-z]+$/i.test(p) || /(_test\.(go|py)|(^|\/)test_[^/]+\.py)$/.test(p);

function gitignore(t) {
  const res = t.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#") && !l.startsWith("!")).map(l => {
    const dir = l.endsWith("/"); let p = l.replace(/\/$/, ""); const anch = p.includes("/"); p = p.replace(/^\//, "");
    const r = p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\u0000/g, ".*");
    return new RegExp((anch ? "^" : "(^|/)") + r + (dir ? "/" : "(/|$)"));
  });
  return p => res.some(r => r.test(p));
}

function tally(text, [, lc, bs, be]) {
  const lines = text.split("\n"); if (lines[lines.length - 1] === "") lines.pop();
  let code = 0, com = 0, blank = 0, inB = false;
  for (const raw of lines) {
    const s = raw.trim();
    if (!s) { blank++; continue; }
    if (inB) { com++; if (s.includes(be)) inB = false; continue; }
    if (lc && s.startsWith(lc)) { com++; continue; }
    if (bs && s.startsWith(bs)) { com++; if (s.indexOf(be, bs.length) < 0) inB = true; continue; }
    code++;
  }
  return { code, com, blank };
}

function count(root, all) {
  let ign = null; try { ign = gitignore(fs.readFileSync(path.join(root, ".gitignore"), "utf8")); } catch {}
  const langs = {}; let files = 0, skipped = 0, tl = 0, pl = 0; const stack = [""];
  while (stack.length) {
    const rel = stack.pop();
    for (const ent of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const p = rel ? rel + "/" + ent.name : ent.name;
      if (ent.isSymbolicLink() || ent.name === ".git") continue;
      if (ent.isDirectory()) {
        if (!all && (SKIPDIR.has(ent.name) || (ign && ign(p + "/")))) { skipped++; continue; }
        stack.push(p); continue;
      }
      if (!all && (GEN.test(p) || (ign && ign(p)))) { skipped++; continue; }
      const name = ent.name.toLowerCase(), ext = name.includes(".") ? name.split(".").pop() : name;
      const full = path.join(root, p);
      if (BIN.has(ext) || fs.statSync(full).size > 5e6) continue;
      const buf = fs.readFileSync(full);
      if (buf.subarray(0, 8000).includes(0)) continue;
      const text = buf.toString("utf8");
      if (!all && /@generated|DO NOT EDIT|auto-?generated|Code generated/i.test(text.slice(0, 400))) { skipped++; continue; }
      const def = L[ext] || ["Other", "", "", ""], t = tally(text, def);
      const g = langs[def[0]] ||= { name: def[0], files: 0, code: 0, comments: 0, blank: 0 };
      g.files++; g.code += t.code; g.comments += t.com; g.blank += t.blank; files++;
      if (!NONCODE.has(def[0])) isTest(p) ? tl += t.code + t.com + t.blank : pl += t.code + t.com + t.blank;
    }
  }
  const list = Object.values(langs).map(g => ({ ...g, total: g.code + g.comments + g.blank })).sort((a, b) => b.total - a.total);
  const sum = k => list.reduce((s, g) => s + g[k], 0);
  const code = sum("code"), eff = 2.4 * Math.pow(code / 1000, 1.05), months = 2.5 * Math.pow(eff, 0.38);
  return { files, skipped, languages: list, totals: { files, code, comments: sum("comments"), blank: sum("blank"), lines: sum("total") },
    testShare: pl + tl ? tl / (pl + tl) : null,
    cocomo: { personMonths: +eff.toFixed(1), months: +months.toFixed(1), cost: Math.round(eff / 12 * 56286 * 1.8) } };
}

const fmt = n => n.toLocaleString("en-US");
const dl = n => (n > 0 ? "+" : n < 0 ? "−" : "±") + fmt(Math.abs(n));
let tmp = null;
function resolve(t) {
  if (fs.existsSync(t)) return t;
  const [spec, ref] = t.split("@"), m = spec.match(/^(?:https?:\/\/github\.com\/)?([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/);
  if (!m) { console.error(`Can't find "${t}". Pass a folder, owner/repo or a GitHub URL.`); process.exit(1); }
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tally-"));
  console.error(`Cloning ${m[1]}…`);
  execFileSync("git", ["clone", "--depth", "1", "--quiet", ...(ref ? ["--branch", ref] : []), `https://github.com/${m[1]}.git`, tmp], { stdio: "inherit" });
  return tmp;
}

try {
  const all = has("--all"), head = count(resolve(target), all), baseDir = val("--diff");
  const base = baseDir ? count(baseDir, all) : null;
  if (has("--json")) console.log(JSON.stringify({ target, ...head, base: base && base.totals }, null, 2));
  else if (has("--csv")) {
    console.log("files,language,blank,comment,code");
    head.languages.forEach(g => console.log(`${g.files},"${g.name}",${g.blank},${g.comments},${g.code}`));
    const T = head.totals; console.log(`${T.files},SUM,${T.blank},${T.comments},${T.code}`);
  } else if (has("--markdown")) {
    const bm = base ? Object.fromEntries(base.languages.map(g => [g.name, g])) : {}, T = head.totals;
    const pct = x => x == null ? "n/a" : Math.round(x * 100) + "%";
    console.log("<!-- tally -->\n### Tally: line count" + (base ? " change" : "") + "\n");
    console.log(base
      ? `**${fmt(T.lines)} lines** (${dl(T.lines - base.totals.lines)}) · code ${fmt(T.code)} (${dl(T.code - base.totals.code)}) · comments ${fmt(T.comments)} (${dl(T.comments - base.totals.comments)}) · tests ${pct(head.testShare)} (was ${pct(base.testShare)})\n`
      : `**${fmt(T.lines)} lines** in ${fmt(T.files)} files · code ${fmt(T.code)} · comments ${fmt(T.comments)} · blank ${fmt(T.blank)}\n`);
    console.log(base ? "| Language | Code | Change | Comments | Change |\n|---|---:|---:|---:|---:|" : "| Language | Files | Code | Comments | Blank |\n|---|---:|---:|---:|---:|");
    for (const g of head.languages.slice(0, 12)) {
      const b = bm[g.name] || { code: 0, comments: 0 };
      console.log(base ? `| ${g.name} | ${fmt(g.code)} | ${dl(g.code - b.code)} | ${fmt(g.comments)} | ${dl(g.comments - b.comments)} |` : `| ${g.name} | ${fmt(g.files)} | ${fmt(g.code)} | ${fmt(g.comments)} | ${fmt(g.blank)} |`);
    }
    console.log(`\n<sub>Estimated effort ${head.cocomo.personMonths} person-months (rough COCOMO model). ${fmt(head.skipped)} vendored or generated files skipped.</sub>`);
  } else {
    const w = Math.max(8, ...head.languages.map(g => g.name.length)), row = (a, b, c, d, e, f) => `${a.padEnd(w)} ${b.padStart(8)} ${c.padStart(10)} ${d.padStart(10)} ${e.padStart(10)} ${f.padStart(10)}`;
    console.log(row("Language", "Files", "Code", "Comments", "Blank", "Total"));
    for (const g of head.languages) console.log(row(g.name, fmt(g.files), fmt(g.code), fmt(g.comments), fmt(g.blank), fmt(g.total)));
    const T = head.totals; console.log("-".repeat(w + 55) + "\n" + row("Total", fmt(T.files), fmt(T.code), fmt(T.comments), fmt(T.blank), fmt(T.lines)));
    console.log(`\nTests: ${head.testShare == null ? "n/a" : Math.round(head.testShare * 100) + "% of code lines"}  |  Estimated effort: ${head.cocomo.personMonths} person-months, about $${fmt(head.cocomo.cost)} (rough COCOMO model)`);
    if (base) console.log(`Change vs ${baseDir}: ${dl(T.lines - base.totals.lines)} lines (${dl(T.code - base.totals.code)} code)`);
  }
} finally { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); }
