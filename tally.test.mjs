// Run with: node --test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const cli = path.join(path.dirname(new URL(import.meta.url).pathname), "tally-cli.mjs");
const run = (...a) => execFileSync("node", [cli, ...a], { encoding: "utf8" });
const make = files => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tally-test-"));
  for (const [p, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), t); }
  return dir;
};

test("splits code, comments and blank lines", () => {
  const dir = make({ "a.js": "// note\n/* block\nmore */\nconst x = 1;\n\nlet y = 2;\n" });
  const r = JSON.parse(run(dir, "--json"));
  assert.deepEqual([r.totals.code, r.totals.comments, r.totals.blank], [2, 3, 1]);
});

test("counts Python docstrings as comments", () => {
  const dir = make({ "a.py": '"""doc\nmore\n"""\nx = 1\n# c\n' });
  const r = JSON.parse(run(dir, "--json"));
  assert.deepEqual([r.totals.code, r.totals.comments], [1, 4]);
});

test("skips vendored folders, lock files, .gitignore matches and generated files", () => {
  const dir = make({ "src/a.js": "x\n", "node_modules/b.js": "x\n", "package-lock.json": "{}\n", ".gitignore": "*.log\n", "a.log": "x\n", "gen.js": "// @generated\nx\n" });
  const r = JSON.parse(run(dir, "--json"));
  assert.equal(r.languages.find(g => g.name === "JavaScript").files, 1);
  assert.ok(r.skipped >= 4);
});

test("--all includes vendored files", () => {
  const dir = make({ "src/a.js": "x\n", "node_modules/b.js": "x\n" });
  assert.equal(JSON.parse(run(dir, "--json", "--all")).languages[0].files, 2);
});

test("--diff reports the change against a base folder", () => {
  const head = make({ "a.py": "x = 1\ny = 2\n" }), base = make({ "a.py": "x = 1\n" });
  const md = run(head, "--diff", base, "--markdown");
  assert.match(md, /<!-- tally -->/);
  assert.match(md, /\+1\)/);
});

test("--csv is cloc-style and ends with a SUM row", () => {
  const out = run(make({ "a.js": "x\n" }), "--csv").trim().split("\n");
  assert.equal(out[0], "files,language,blank,comment,code");
  assert.match(out[out.length - 1], /^1,SUM,0,0,1$/);
});

test("detects test files for the test share", () => {
  const r = JSON.parse(run(make({ "src/a.js": "x\ny\n", "src/a.test.js": "x\ny\n" }), "--json"));
  assert.equal(r.testShare, 0.5);
});
