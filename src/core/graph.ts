// The internal dependency graph: resolves imports to files, then finds cycles, hubs and orphans. Pure functions only.

import type { FileStat, Graph, GraphEdge } from "./types";

const normalize = (p: string) => { const out: string[] = []; for (const s of p.split("/")) { if (s === "..") out.pop(); else if (s !== "." && s) out.push(s); } return out.join("/"); };
const dirOf = (p: string) => p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
const JS_TRY = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".rb", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];

function resolver(paths: string[]) {
  const set = new Set(paths), bySuffix = new Map<string, string[]>();
  for (const p of paths) { const b = p.split("/").pop()!; (bySuffix.get(b) || bySuffix.set(b, []).get(b)!).push(p); }
  const suffix = (rel: string) => { const c = bySuffix.get(rel.split("/").pop()!) || []; return c.filter(p => p === rel || p.endsWith("/" + rel)).sort((a, b) => a.length - b.length)[0] || null; };
  const anyOf = (list: (string | null)[]) => { for (const x of list) if (x) { const hit = set.has(x) ? x : null; if (hit) return hit; } return null; };
  const dirs = new Map<string, string[]>();
  for (const p of paths) { const d = dirOf(p); (dirs.get(d) || dirs.set(d, []).get(d)!).push(p); }
  return (from: string, spec: string): string | null => {
    const [kind] = spec.split(":"), s = spec.slice(kind.length + 1), here = dirOf(from);
    if (kind === "js") {
      if (!s.startsWith(".")) return null;
      const base = normalize(here + "/" + s), swap = base.replace(/\.m?js$/, ".ts");
      return anyOf([...JS_TRY.map(e => base + e), swap, swap + "x"]);
    }
    if (kind === "py") {
      const dots = s.match(/^\.*/)![0].length, rest = s.slice(dots).replace(/\./g, "/");
      if (dots) { let d = here; for (let i = 1; i < dots; i++) d = dirOf(d); const b = normalize(d + "/" + rest); return anyOf([b + ".py", b + "/__init__.py"]); }
      return rest ? suffix(rest + ".py") || suffix(rest + "/__init__.py") : null;
    }
    if (kind === "go") { const tail = s.split("/").slice(-2).join("/"); for (const [d, list] of dirs) if (d === tail || d.endsWith("/" + tail)) return list.filter(p => p.endsWith(".go") && !p.endsWith("_test.go")).sort()[0] || null; return null; }
    if (kind === "rm") return anyOf([normalize(here + "/" + s + ".rs"), normalize(here + "/" + s + "/mod.rs")]);
    if (kind === "ru") { const parts = s.split("::"); for (let i = parts.length; i > 0; i--) { const b = parts.slice(0, i).join("/"), hit = suffix(b + ".rs") || suffix(b + "/mod.rs"); if (hit) return hit; } return null; }
    if (kind === "c") return anyOf([normalize(here + "/" + s)]) || suffix(s.replace(/^(\.\.\/)+/, ""));
    if (kind === "jv") { const b = s.replace(/\./g, "/"); return suffix(b + ".java") || suffix(b + ".kt") || suffix(b + ".scala"); }
    return null;
  };
}

function externalName(spec: string) {
  const [kind] = spec.split(":"), s = spec.slice(kind.length + 1);
  if (kind === "js") return s.startsWith(".") || s.startsWith("/") ? null : s.split("/").slice(0, s.startsWith("@") ? 2 : 1).join("/").replace(/^node:/, "");
  if (kind === "py") return s.startsWith(".") ? null : s.split(".")[0];
  if (kind === "go") return s.includes(".") ? s.split("/").slice(0, 3).join("/") : null;
  return null;
}

// strongly connected components with more than one file are import cycles
function cyclesOf(n: number, adj: number[][]) {
  const index: number[] = new Array(n).fill(-1), low: number[] = new Array(n).fill(0), on: boolean[] = new Array(n).fill(false), stack: number[] = [], out: number[][] = []; let t = 0;
  for (let root = 0; root < n; root++) {
    if (index[root] >= 0) continue;
    const work: [number, number][] = [[root, 0]];
    while (work.length) {
      const top = work[work.length - 1], v = top[0];
      if (top[1] === 0) { index[v] = low[v] = t++; stack.push(v); on[v] = true; }
      let pushed = false;
      while (top[1] < adj[v].length) {
        const w = adj[v][top[1]++];
        if (index[w] < 0) { work.push([w, 0]); pushed = true; break; }
        if (on[w]) low[v] = Math.min(low[v], index[w]);
      }
      if (pushed) continue;
      work.pop();
      if (work.length) { const u = work[work.length - 1][0]; low[u] = Math.min(low[u], low[v]); }
      if (low[v] === index[v]) { const c: number[] = []; let w: number; do { w = stack.pop()!; on[w] = false; c.push(w); } while (w !== v); if (c.length > 1) out.push(c); }
    }
  }
  return out.sort((a, b) => b.length - a.length);
}

export function buildGraph(files: FileStat[], { limit = 140 } = {}): Graph {
  const src = files.filter(f => f.imports && !f.test);
  const paths = files.filter(f => !f.test).map(f => f.path), resolve = resolver(paths);
  const id = new Map(src.map((f, i) => [f.path, i])), adj: number[][] = src.map(() => []), inn: number[] = new Array(src.length).fill(0), ext: Record<string, number> = {};
  src.forEach((f, i) => {
    const seen = new Set<number>(), used = new Set<string>();
    for (const spec of f.imports) {
      const to = resolve(f.path, spec), j = to != null ? id.get(to) : undefined;
      if (j !== undefined) { if (j !== i && !seen.has(j)) { seen.add(j); adj[i].push(j); inn[j]++; } continue; }
      const e = to == null ? externalName(spec) : null;
      if (e && !used.has(e)) { used.add(e); ext[e] = (ext[e] || 0) + 1; }
    }
  });
  const cycles = cyclesOf(src.length, adj), inCycle = new Set(cycles.flat());
  const degree = (i: number) => inn[i] + adj[i].length;
  const linked = src.map((_, i) => i).filter(i => degree(i) > 0);
  const keep = [...linked].sort((a, b) => (+inCycle.has(b) - +inCycle.has(a)) || degree(b) - degree(a)).slice(0, limit);
  const pos = new Map(keep.map((v, k) => [v, k]));
  const nodes = keep.map(i => ({ path: src[i].path, lines: src[i].lines, in: inn[i], out: adj[i].length, cycle: inCycle.has(i), group: src[i].path.includes("/") ? src[i].path.split("/")[src[i].path.split("/").length > 2 ? 1 : 0] : "(root)" }));
  const edges: GraphEdge[] = [];
  keep.forEach(i => adj[i].forEach(j => { if (pos.has(j)) edges.push({ a: pos.get(i)!, b: pos.get(j)!, cycle: inCycle.has(i) && inCycle.has(j) && cycles.some(c => c.includes(i) && c.includes(j)) }); }));
  const hubs = src.map((f, i) => ({ path: f.path, in: inn[i], out: adj[i].length, lines: f.lines })).filter(h => h.in > 0).sort((a, b) => b.in - a.in).slice(0, 10);
  const heavy = src.map((f, i) => ({ path: f.path, in: inn[i], out: adj[i].length, lines: f.lines })).filter(h => h.out > 0).sort((a, b) => b.out - a.out).slice(0, 10);
  const edgeCount = adj.reduce((t, a) => t + a.length, 0);
  const neighbors: Record<string, string[]> = {};
  src.forEach((f, i) => { if (adj[i].length) neighbors[f.path] = adj[i].map(j => src[j].path); });
  return {
    files: src.length, linked: linked.length, edges: edges, edgeCount, nodes, hubs, heavy, neighbors, shown: nodes.length,
    cycles: cycles.slice(0, 10).map(c => c.map(i => src[i].path).sort()), cycleCount: cycles.length,
    external: Object.entries(ext).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([label, value]) => ({ label, value }))
  };
}

// a small seeded force layout, so the same repository always draws the same map
export function forceLayout(g: Graph, W = 1000, H = 560): [number, number][] {
  const n = g.nodes.length, ang = Math.PI * (3 - Math.sqrt(5));
  const groups = [...new Set(g.nodes.map(x => x.group))], anchor: Record<string, [number, number]> = Object.fromEntries(groups.map((k, i) => { const t = i / groups.length * Math.PI * 2; const spread = groups.length > 1 ? .27 : 0; return [k, [W / 2 + Math.cos(t) * W * spread, H / 2 + Math.sin(t) * H * spread]]; }));
  const P = g.nodes.map((_, i) => ({ x: W / 2 + Math.cos(i * ang) * 7 * Math.sqrt(i + 1), y: H / 2 + Math.sin(i * ang) * 7 * Math.sqrt(i + 1), vx: 0, vy: 0 }));
  const k = Math.min(Math.sqrt(W * H / Math.max(n, 1)) * .42, 90);
  for (let it = 0; it < 260; it++) {
    const cool = 1 - it / 260;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      let dx = P[i].x - P[j].x, dy = P[i].y - P[j].y, d2 = dx * dx + dy * dy + .01; const f = k * k / d2 * .09;
      P[i].vx += dx * f; P[i].vy += dy * f; P[j].vx -= dx * f; P[j].vy -= dy * f;
    }
    for (const e of g.edges) { const a = P[e.a], b = P[e.b], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) + .01, f = (d - k) / d * .06; a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f; }
    g.nodes.forEach((x, i) => { const [ax, ay] = anchor[x.group]; P[i].vx += (ax - P[i].x) * .05; P[i].vy += (ay - P[i].y) * .05; });
    for (const p of P) { const v = Math.hypot(p.vx, p.vy) || 1, m = Math.min(v, 34 * cool + 1); p.x = Math.max(24, Math.min(W - 24, p.x + p.vx / v * m)); p.y = Math.max(20, Math.min(H - 20, p.y + p.vy / v * m)); p.vx *= .5; p.vy *= .5; }
  }
  return P.map(p => [Math.round(p.x), Math.round(p.y)] as [number, number]);
}
