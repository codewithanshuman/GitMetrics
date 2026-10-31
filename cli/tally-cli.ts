// GitMetrics CLI: count code, comments and blanks in a folder or GitHub repo. Node 18+, no dependencies.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { langOf, tally, gitignore, isTest, cocomo, extOf, BIN, SKIPDIR, GENERATED as GEN, GEN_MARK, NONCODE } from "../src/core/engine";
import type { LangTotals } from "../src/core/types";

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const val = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const target = argv.find((a, i) => !a.startsWith("-") && argv[i - 1] !== "--diff") || ".";
if (has("-h") || has("--help")) {
  console.log(`GitMetrics CLI
Usage: npm run cli -- [folder | owner/repo[@branch] | github-url] [options]
  --json            print JSON
  --markdown        print a Markdown report
  --csv             print cloc-style CSV (files,language,blank,comment,code)
  --diff <folder>   compare against another folder (for example the base of a pull request)
  --all             include vendored, generated and lock files`);
  process.exit(0);
}

interface Row extends Omit<LangTotals, "com"> { comments: number; total: number }
function count(root: string, all: boolean) {
  let ign: ((p: string) => boolean) | null = null; try { ign = gitignore(fs.readFileSync(path.join(root, ".gitignore"), "utf8")); } catch {}
  const langs: Record<string, Omit<Row, "total">> = {}; let files = 0, skipped = 0, tl = 0, pl = 0; const stack: string[] = [""];
  while (stack.length) {
    const rel = stack.pop()!;
    for (const ent of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const p = rel ? rel + "/" + ent.name : ent.name;
      if (ent.isSymbolicLink() || ent.name === ".git") continue;
      if (ent.isDirectory()) {
        if (!all && (SKIPDIR.has(ent.name) || (ign && ign(p + "/")))) { skipped++; continue; }
        stack.push(p); continue;
      }
      if (!all && (GEN.test(p) || (ign && ign(p)))) { skipped++; continue; }
      const ext = extOf(ent.name.toLowerCase());
      const full = path.join(root, p);
      if (BIN.has(ext) || fs.statSync(full).size > 5e6) continue;
      const buf = fs.readFileSync(full);
      if (buf.subarray(0, 8000).includes(0)) continue;
      const text = buf.toString("utf8");
      if (!all && GEN_MARK.test(text.slice(0, 400))) { skipped++; continue; }
      const def = langOf(ent.name), t = tally(text, def);
      const g = langs[def[0]] ||= { name: def[0], files: 0, code: 0, comments: 0, blank: 0 };
      g.files++; g.code += t.code; g.comments += t.com; g.blank += t.blank; files++;
      if (!NONCODE.has(def[0])) { if (isTest(p)) tl += t.code + t.com + t.blank; else pl += t.code + t.com + t.blank; }
    }
  }
  const list: Row[] = Object.values(langs).map(g => ({ ...g, total: g.code + g.comments + g.blank })).sort((a, b) => b.total - a.total);
  const sum = (k: "code" | "comments" | "blank" | "total") => list.reduce((s, g) => s + g[k], 0);
  const code = sum("code"), { personMonths, months, cost } = cocomo(code);
  return { files, skipped, languages: list, totals: { files, code, comments: sum("comments"), blank: sum("blank"), lines: sum("total") },
    testShare: pl + tl ? tl / (pl + tl) : null,
    cocomo: { personMonths, months, cost } };
}

const fmt = (n: number) => n.toLocaleString("en-US");
const dl = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "±") + fmt(Math.abs(n));
let tmp: string | null = null;
function resolve(t: string) {
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
    const bm: Record<string, Row> = base ? Object.fromEntries(base.languages.map(g => [g.name, g])) : {}, T = head.totals;
    const pct = (x: number | null) => x == null ? "n/a" : Math.round(x * 100) + "%";
    console.log("<!-- tally -->\n### GitMetrics: line count" + (base ? " change" : "") + "\n");
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
    const w = Math.max(8, ...head.languages.map(g => g.name.length)), row = (a: string, b: string, c: string, d: string, e: string, f: string) => `${a.padEnd(w)} ${b.padStart(8)} ${c.padStart(10)} ${d.padStart(10)} ${e.padStart(10)} ${f.padStart(10)}`;
    console.log(row("Language", "Files", "Code", "Comments", "Blank", "Total"));
    for (const g of head.languages) console.log(row(g.name, fmt(g.files), fmt(g.code), fmt(g.comments), fmt(g.blank), fmt(g.total)));
    const T = head.totals; console.log("-".repeat(w + 55) + "\n" + row("Total", fmt(T.files), fmt(T.code), fmt(T.comments), fmt(T.blank), fmt(T.lines)));
    console.log(`\nTests: ${head.testShare == null ? "n/a" : Math.round(head.testShare * 100) + "% of code lines"}  |  Estimated effort: ${head.cocomo.personMonths} person-months, about $${fmt(head.cocomo.cost)} (rough COCOMO model)`);
    if (base) console.log(`Change vs ${baseDir}: ${dl(T.lines - base.totals.lines)} lines (${dl(T.code - base.totals.code)} code)`);
  }
} finally { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); }
