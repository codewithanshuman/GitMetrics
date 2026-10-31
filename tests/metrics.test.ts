import { test } from "vitest";
import assert from "node:assert/strict";
import { tally, gitignore, parseDeps, countEntries } from "../src/core/engine";
import { band, grade, median, weeklyFromAuthors, flowStats, busFactor, summarize, deepStats, scanTargets, summarizeVuln, squarify, fileTree } from "../src/core/metrics";

const JS = ["JavaScript", "//", "/*", "*/"], PY = ["Python", "#", '"""', '"""', "'''", "'''"];

test("code after a closing block comment still counts as code", () => {
  assert.deepEqual(tally("/* a */ run();\n/* b\nc */ go();\n/* d */ // e\n", JS), { code: 2, com: 2, blank: 0 });
});

test("single-quoted Python docstrings are comments", () => {
  assert.deepEqual(tally("'''doc\nmore\n'''\nx = 1\n", PY), { code: 1, com: 3, blank: 0 });
});

test("gitignore negation re-includes a file", () => {
  const ign = gitignore("*.log\n!keep.log\nbuild/\n");
  assert.deepEqual([ign("a.log"), ign("keep.log"), ign("build/x.js"), ign("src/a.js")], [true, false, true, false]);
});

test("manifests and lock files give versions for the vulnerability scan", () => {
  const pkg = parseDeps("package.json", '{"dependencies":{"a":"^1.2.3","b":"latest"},"devDependencies":{"c":"~2.0.0"}}');
  assert.deepEqual(pkg.vers, { a: "1.2.3", c: "2.0.0" });
  assert.deepEqual(parseDeps("requirements.txt", "flask==3.0.1\nrequests>=2.0\n# x\nnumpy\n").vers, { flask: "3.0.1", requests: "2.0" });
  assert.equal(parseDeps("go.mod", "require (\n  github.com/a/b v1.4.0\n)\n").vers["github.com/a/b"], "1.4.0");
  assert.equal(parseDeps("cargo.toml", '[dependencies]\nserde = "1.0"\ntokio = { version = "1.2", features = [] }\n').vers.tokio, "1.2");
  assert.equal(parseDeps("gemfile.lock", "GEM\n  specs:\n    rack (2.2.3)\n      x (>= 1)\n").vers.rack, "2.2.3");
  assert.equal(parseDeps("uv.lock", '[[package]]\nname = "click"\nversion = "8.1.7"\nsource = {}\n').vers.click, "8.1.7");
  const lock = parseDeps("package-lock.json", '{"packages":{"":{},"node_modules/a":{"version":"1.2.9"},"node_modules/@s/b":{"version":"2.0.0"}}}');
  assert.deepEqual(lock.vers, { a: "1.2.9", "@s/b": "2.0.0" });
  const t = scanTargets([{ ...pkg, file: "p" }, { ...lock, file: "l" }]);
  assert.equal(t.find(x => x.name === "a").version, "1.2.9");
  assert.equal(t.find(x => x.name === "a").exact, true);
});

test("countEntries reads the lock file while keeping it out of the line count", async () => {
  const e = s => ({ size: s.length, async: async () => new TextEncoder().encode(s) });
  const r = await countEntries([["a.js", e("x\n")], ["package-lock.json", e('{"packages":{"node_modules/a":{"version":"1.0.0"}}}')]]);
  assert.equal(r.files.length, 1);
  assert.equal(r.deps[0].vers.a, "1.0.0");
});

test("scoring helpers", () => {
  assert.equal(band(15, [[0, 100], [30, 50]]), 75);
  assert.equal(band(-1, [[0, 100], [30, 50]]), 100);
  assert.equal(band(99, [[0, 100], [30, 50]]), 50);
  assert.deepEqual(["A", "B", "C", "D", "F"], [90, 70, 55, 40, 10].map(grade));
  assert.equal(median([3, 1, 2, 10]), 2.5);
  assert.equal(busFactor([{ contributions: 1 }, { contributions: 8 }, { contributions: 1 }]), 1);
  assert.equal(busFactor([]), null);
});

const NOW = Date.parse("2026-06-01T00:00:00Z");
const repo = (over = {}) => ({ o: "a", n: "b", m: { pushed_at: "2026-05-30T00:00:00Z", license: { spdx_id: "MIT" }, ...over }, langs: { JavaScript: { name: "JavaScript", files: 2, code: 900, com: 100, blank: 50 } }, files: [{ path: "src/a.js", lang: "JavaScript", lines: 800, br: 30, test: false }, { path: "test/a.test.js", lang: "JavaScript", lines: 250, br: 0, test: true }], dup: .02, who: [{ contributions: 5 }, { contributions: 5 }], rel: [] });

test("missing data drops out of the health score instead of scoring zero", () => {
  const s = summarize(repo(), NOW);
  assert.equal(s.health.dims.find(d => d.key === "release").score, null);
  assert.ok(s.health.score >= 70, "score was " + s.health.score);
  assert.equal(s.testShare, 250 / 1050);
});

test("findings flag abandoned, unlicensed repositories first", () => {
  const s = summarize(repo({ archived: true, license: null, pushed_at: "2024-01-01T00:00:00Z" }), NOW);
  assert.ok(s.findings.length >= 3);
  assert.equal(s.findings[0].level, "risk");
  assert.ok(s.findings.some(f => f.title === "No license"));
  assert.ok(s.health.dims.find(d => d.key === "activity").score < 20);
});

test("local folders have no health score", () => {
  assert.equal(summarize({ ...repo(), local: true }, NOW).health, null);
});

test("flowStats buckets open items and takes medians", () => {
  const i = (c, cl, o = {}) => ({ created: c, closed: cl, updated: cl || c, merged: null, pr: false, labels: [], ...o });
  const f = flowStats([i("2026-05-01", "2026-05-03"), i("2026-05-01", "2026-05-05"), i("2026-05-30", null), i("2024-01-01", null, { labels: ["bug"] }), i("2026-05-01", "2026-05-02", { pr: true, merged: "2026-05-02" })], NOW);
  assert.equal(f.issueMedian, 3);
  assert.equal(f.prMedian, 1);
  assert.equal(f.stale, 1);
  assert.deepEqual(f.ages.map(a => a.value), [1, 0, 0, 0, 1]);
  assert.deepEqual(f.labels, [{ label: "bug", value: 1 }]);
});

test("deepStats finds churn, coupling and ownership, and ignores sweeping commits", () => {
  const f = p => ({ path: p, add: 1, del: 1 });
  const known = [{ path: "src/a.js", br: 40, lines: 100, lang: "JavaScript" }, { path: "src/b.js", br: 1, lines: 10, lang: "JavaScript" }];
  const wide = Array.from({ length: 25 }, (_, i) => f("x" + i));
  const d = deepStats([{ author: "ann", files: [f("src/a.js"), f("src/b.js")] }, { author: "ann", files: [f("src/a.js"), f("src/b.js")] }, { author: "bo", files: [f("src/a.js")] }, { author: "bo", files: wide }, { author: "bo", files: [f("gone.js")] }], known);
  assert.equal(d.hot[0].path, "src/a.js");
  assert.equal(d.hot[0].authors, 2);
  assert.equal(d.hot.find(h => h.path === "gone.js"), undefined);
  assert.deepEqual([d.coupling.length, d.coupling[0].n, d.coupling[0].ratio], [1, 2, 1]);
  assert.equal(d.ownership[0].owner, "ann");
});

test("summarizeVuln normalizes severity and finds the fix", () => {
  const v = summarizeVuln({ id: "GHSA-1", aliases: ["CVE-2020-1"], summary: "bad", database_specific: { severity: "MODERATE" }, affected: [{ ranges: [{ events: [{ introduced: "0" }, { fixed: "1.2.4" }] }] }] });
  assert.deepEqual([v.severity, v.rank, v.fixed, v.alias], ["MODERATE", 2, "1.2.4", "CVE-2020-1"]);
  assert.equal(summarizeVuln({ id: "X" }).severity, "UNRATED");
});

test("weeklyFromAuthors adds up authors week by week", () => {
  const w = weeklyFromAuthors([{ weeks: [{ w: 100, c: 2 }, { w: 200, c: 1 }] }, { weeks: [{ w: 200, c: 3 }] }]);
  assert.deepEqual(w, [{ week: 100, total: 2, days: null }, { week: 200, total: 4, days: null }]);
  assert.equal(weeklyFromAuthors(null), null);
});

test("lock files of any tool and test files stay out of the numbers", async () => {
  const e = s => ({ size: s.length, async: async () => new TextEncoder().encode(s) });
  const line = "const someLongRepeatedLineOfCode = 12345;\n";
  const r = await countEntries([["uv.lock", e("x = 1\n")], ["a.js", e("let a;\n")], ["t/a.test.js", e(line)], ["t/b.test.js", e(line)], ["b.js", e("const anotherLineThatIsLongEnough = 1;\n")]]);
  assert.equal(r.files.some(f => f.path === "uv.lock"), false);
  assert.equal(r.dup, 0);
});

test("squarify fills the area without overlap", () => {
  const r = squarify([{ v: 6 }, { v: 6 }, { v: 4 }, { v: 3 }, { v: 2 }, { v: 2 }, { v: 1 }, { v: 0 }], 0, 0, 600, 400);
  assert.equal(r.length, 7);
  assert.ok(Math.abs(r.reduce((t, x) => t + x.w * x.h, 0) - 240000) < 1e-6);
  assert.ok(r.every(x => x.x >= -1e-9 && x.y >= -1e-9 && x.x + x.w <= 600 + 1e-9 && x.y + x.h <= 400 + 1e-9));
  assert.ok(Math.abs(r[0].w * r[0].h / (r[1].w * r[1].h) - 1) < 1e-9);
});

test("fileTree nests folders and totals their lines", () => {
  const t = fileTree([{ path: "a/b/c.js", lines: 5, lang: "JavaScript" }, { path: "a/d.py", lines: 3, lang: "Python" }, { path: "r.md", lines: 2, lang: "Markdown" }]);
  assert.equal(t.v, 10);
  assert.equal(t.dirs.a.v, 8);
  assert.equal(t.dirs.a.dirs.b.files[0].path, "a/b/c.js");
});
