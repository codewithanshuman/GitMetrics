import { test } from "vitest";
import assert from "node:assert/strict";
import { importsOf, scanText, parseQuery, mask } from "../src/core/scan";
import { buildGraph, forceLayout } from "../src/core/graph";
import { forecast, prStats, behind, summarize, fmtDur } from "../src/core/metrics";

test("importsOf reads each language's import syntax", () => {
  assert.deepEqual(importsOf('import a from "./a.js";\nconst b = require("../b");\nexport { c } from "pkg/x";\nimport("./lazy");\n', "JavaScript").sort(), ["js:../b", "js:./a.js", "js:./lazy", "js:pkg/x"]);
  assert.deepEqual(importsOf("from .models import User, Post\nimport os, sys\n", "Python").sort(), ["py:.models", "py:.models.Post", "py:.models.User", "py:os", "py:sys"]);
  assert.deepEqual(importsOf('import (\n  "fmt"\n  "a.io/b/c"\n)\n', "Go").sort(), ["go:a.io/b/c", "go:fmt"]);
  assert.deepEqual(importsOf("mod util;\nuse crate::core::run;\n", "Rust").sort(), ["rm:util", "ru:core::run"]);
  assert.deepEqual(importsOf('#include "x.h"\n#include <stdio.h>\n', "C"), ["c:x.h"]);
  assert.deepEqual(importsOf("import a.b.C;\n", "Java"), ["jv:a.b.C"]);
});

const f = (path, imports, lines = 10, test = false) => ({ path, imports, lines, test, lang: "JavaScript" });

test("buildGraph resolves imports, finds cycles and hubs, and ignores tests", () => {
  const g = buildGraph([f("src/a.js", ["js:./b", "js:./c.js", "js:react"]), f("src/b.ts", ["js:./a.js"]), f("src/c.js", ["js:react", "js:lodash/get"]), f("test/a.test.js", ["js:../src/a.js"], 10, true)]);
  assert.equal(g.files, 3);
  assert.equal(g.edgeCount, 3);
  assert.deepEqual([g.cycleCount, g.cycles[0]], [1, ["src/a.js", "src/b.ts"]]);
  assert.equal(g.edges.filter(e => e.cycle).length, 2);
  assert.deepEqual(g.external, [{ label: "react", value: 2 }, { label: "lodash", value: 1 }]);
  assert.deepEqual(g.neighbors["src/b.ts"], ["src/a.js"]);
});

test("buildGraph resolves Python packages, including src layouts", () => {
  const g = buildGraph([{ ...f("src/app/core.py", ["py:.helpers", "py:app.models.user"]), lang: "Python" }, { ...f("src/app/helpers.py", []), lang: "Python" }, { ...f("src/app/models/user.py", []), lang: "Python" }]);
  assert.equal(g.edgeCount, 2);
});

test("forceLayout is deterministic and stays in bounds", () => {
  const g = buildGraph([f("a/a.js", ["js:./b"]), f("a/b.js", ["js:../c/c"]), f("c/c.js", [])]);
  const p = forceLayout(g, 400, 300);
  assert.deepEqual(p, forceLayout(g, 400, 300));
  assert.ok(p.every(([x, y]) => x >= 0 && x <= 400 && y >= 0 && y <= 300));
});

test("scanText masks secrets and skips placeholders and sample folders", () => {
  const key = "AKIA" + "ABCDEFGHIJKLMNOP";
  const r = scanText("src/c.py", `k = "${key}"\npassword = "changeme-example-1"\n# TODO: fix this\npassword = "Xk29dkKs02kdLq"\n`, "Python", true);
  assert.deepEqual(r.flags.map(x => x.name), ["AWS access key", "Hardcoded credential"]);
  assert.equal(r.flags[0].line, 1);
  assert.ok(!JSON.stringify(r).includes(key));
  assert.equal(mask("abcdefghijkl"), "abcd••••kl");
  assert.deepEqual([r.debt[0].tag, r.debt[0].line], ["TODO", 3]);
  assert.equal(scanText("tests/c.py", `k = "${key}"`, "Python", true).flags.length, 0);
  assert.equal(scanText("a.js", "el.innerHTML = x;\n// eval(y)\n", "JavaScript", true).flags[0].name, "Raw HTML injection");
});

test("parseQuery combines fields, comparisons and words", () => {
  const a = { path: "src/app.py", lang: "Python", lines: 600, br: 12, test: false, todo: 2, imports: ["x"] }, b = { path: "tests/t.js", lang: "JavaScript", lines: 50, br: 0, test: true, todo: 0 };
  const hit = q => [a, b].filter(parseQuery(q)).map(x => x.path);
  assert.deepEqual(hit("lang:python lines:>500"), ["src/app.py"]);
  assert.deepEqual(hit("test:true"), ["tests/t.js"]);
  assert.deepEqual(hit("branches:<=0"), ["tests/t.js"]);
  assert.deepEqual(hit("src/ todo:>=2 imports:1"), ["src/app.py"]);
  assert.deepEqual(hit(""), ["src/app.py", "tests/t.js"]);
});

test("forecast projects the trend and never goes below zero", () => {
  const up = forecast(Array.from({ length: 26 }, (_, i) => ({ total: i })));
  assert.equal(up.trend, "rising");
  assert.ok(up.next > up.last);
  assert.equal(forecast(Array.from({ length: 26 }, (_, i) => ({ total: 25 - i }))).next, 0);
  assert.equal(forecast(Array.from({ length: 26 }, () => ({ total: 4 }))).trend, "steady");
  assert.equal(forecast(null), null);
});

test("prStats scores size, missing tests and sensitive files", () => {
  const pr = { state: "open", created_at: "2026-01-01T00:00:00Z" };
  const big = prStats(pr, [{ filename: "src/auth/login.py", additions: 900, deletions: 300 }], [], Date.parse("2026-01-03T00:00:00Z"));
  assert.deepEqual([big.size, big.level, big.sensitive, big.age], ["XL", "High", 1, 2]);
  assert.ok(big.notes.some(n => n.title === "No tests changed"));
  const small = prStats(pr, [{ filename: "src/a.py", additions: 5, deletions: 1 }, { filename: "tests/test_a.py", additions: 4, deletions: 0 }], [{ user: { login: "x" }, state: "CHANGES_REQUESTED" }, { user: { login: "x" }, state: "APPROVED" }]);
  assert.deepEqual([small.size, small.level, small.approved, small.blocked], ["S", "Low", 1, 0]);
});

test("durations read naturally", () => {
  assert.deepEqual([fmtDur(1 / 24), fmtDur(.5), fmtDur(3)], ["1 hour", "12 hours", "3.0 days"]);
});

test("behind counts major versions", () => {
  assert.equal(behind("1.2.3", "3.0.0"), 2);
  assert.equal(behind("3.1.0", "3.9.0"), 0);
  assert.equal(behind("abc", "1.0"), null);
});

test("the brief summarizes a repository in plain sentences", () => {
  const d = { m: { full_name: "a/b", pushed_at: "2026-05-30T00:00:00Z", license: { spdx_id: "MIT" } }, langs: { Python: { name: "Python", files: 1, code: 100, com: 10, blank: 5 } }, files: [{ path: "a.py", lang: "Python", lines: 115, br: 1, imports: [] }], who: [], rel: [], act: Array.from({ length: 52 }, () => ({ total: 3 })) };
  const s = summarize(d, Date.parse("2026-06-01T00:00:00Z"));
  assert.match(s.brief, /a\/b is a Python codebase of 115 lines/);
  assert.match(s.brief, /steady/);
  assert.match(s.brief, /No serious risks/);
});
