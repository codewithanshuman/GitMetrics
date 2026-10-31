// GitHub and OSV.dev access. Everything runs from the browser, with no server in between.
import { summarizeVuln, weeklyFromAuthors, behind } from "./metrics";
import type { AuthorStat, CodeFreq, Community, CountResult, DeepCommit, DepManifest, Entry, GhContributor, GhRelease, GhRepo, Issue, OutdatedRow, PrFile, PrInfo, PrReview, ProfileData, Punch, Report, ScanTarget, StarHistory, VulnReport, VulnRow, WeekActivity } from "./types";

export const API = { base: "https://api.github.com", raw: "https://raw.githubusercontent.com", osv: "https://api.osv.dev", npm: "https://registry.npmjs.org", pypi: "https://pypi.org/pypi" };
export const rate: { remaining: number | null; limit: number | null; reset: number | null; onChange: (() => void) | null } = { remaining: null, limit: null, reset: null, onChange: null };
const MAX_FILES = 12000, wait = (ms: number) => new Promise(r => setTimeout(r, ms));

export class RateLimitError extends Error {
  reset?: number;
  constructor(reset?: number) {
    super("GitHub’s rate limit was reached" + (reset ? ", and it resets at " + new Date(reset * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "") + ". Add a token in Settings to raise the limit.");
    this.reset = reset;
  }
}

const rethrow = (e: unknown) => { if ((e as Error).name === "AbortError") throw e; };
export type Client = ReturnType<typeof client>;
export function client(token: string, signal?: AbortSignal) {
  const api = async (path: string, accept?: string) => {
    const r = await fetch(path.startsWith("http") ? path : API.base + path, { signal, headers: { Accept: accept || "application/vnd.github+json", ...(token ? { Authorization: "Bearer " + token } : {}) } });
    const rem = r.headers.get("x-ratelimit-remaining");
    if (rem != null && !path.startsWith("/search")) {
      // parallel responses arrive out of order, so within one window the lowest number is the true one
      const reset = +r.headers.get("x-ratelimit-reset")!;
      rate.remaining = rate.reset === reset && rate.remaining != null ? Math.min(rate.remaining, +rem) : +rem; rate.limit = +r.headers.get("x-ratelimit-limit")!; rate.reset = +r.headers.get("x-ratelimit-reset")!; rate.onChange && rate.onChange(); }
    return r;
  };
  const limited = (r: Response) => (r.status === 403 || r.status === 429) && r.headers.get("x-ratelimit-remaining") === "0";
  const json = async <T,>(path: string, fallback: T | null = null, accept?: string): Promise<T | null> => {
    try {
      const r = await api(path, accept);
      return r.ok && r.status !== 204 ? await r.json() : fallback;
    } catch (e) { rethrow(e); return fallback; }
  };
  // a list plus its full size, read from the pagination header
  const list = async <T,>(path: string): Promise<{ items: T[]; count: number | null; more?: boolean }> => {
    try {
      const r = await api(path + (path.includes("?") ? "&" : "?") + "per_page=100");
      if (!r.ok) return { items: [], count: null };
      const items = await r.json(), m = (r.headers.get("link") || "").match(/[&?]page=(\d+)>; rel="last"/);
      return { items: Array.isArray(items) ? items : [], count: m ? (+m[1] - 1) * 100 : items.length, more: !!m };
    } catch (e) { rethrow(e); return { items: [], count: null }; }
  };
  const count = async (path: string): Promise<number | null> => {
    try {
      const r = await api(path + (path.includes("?") ? "&" : "?") + "per_page=1");
      if (!r.ok) return null;
      const m = (r.headers.get("link") || "").match(/[&?]page=(\d+)>; rel="last"/);
      return m ? +m[1] : (await r.json()).length;
    } catch (e) { rethrow(e); return null; }
  };
  // GitHub computes these on demand and answers 202 until they're ready
  const stats = async <T,>(path: string, tries = 3): Promise<T[] | null> => {
    for (let i = 0; i < tries; i++) {
      if (i && rate.remaining != null && rate.remaining < 10) return null;
      try {
        const r = await api(path);
        if (r.status === 200) { const j = await r.json(); return Array.isArray(j) && j.length ? j : null; }
        if (r.status !== 202) return null;
      } catch (e) { rethrow(e); return null; }
      await wait(1500 + i * 500);
    }
    return null;
  };
  return { api, json, list, count, stats, limited };
}

const slimIssue = (i: any): Issue => ({ number: i.number, title: i.title, pr: !!i.pull_request, created: i.created_at, updated: i.updated_at, closed: i.closed_at, merged: i.pull_request ? i.pull_request.merged_at : null, labels: (i.labels || []).map((l: any) => l.name) });

export interface Blob { path: string; size: number }
async function listBlobs(gh: Client, o: string, n: string, ref: string) {
  const rp = ref.split("/").map(encodeURIComponent).join("/");
  const tr = await gh.api(`/repos/${o}/${n}/git/trees/${rp}?recursive=1`);
  if (gh.limited(tr)) throw new RateLimitError(+tr.headers.get("x-ratelimit-reset")!);
  if (tr.status === 404 || tr.status === 409) throw new Error(`That branch, tag or commit wasn’t found in ${o}/${n}, or the repository is empty.`);
  if (!tr.ok) throw new Error(`The file list couldn’t be read (${tr.status}).`);
  const tj = await tr.json();
  const blobs: Blob[] = tj.tree.filter((t: any) => t.type === "blob").map((t: any) => ({ path: t.path, size: t.size }));
  return { blobs: blobs.slice(0, MAX_FILES), truncated: !!tj.truncated, capped: blobs.length > MAX_FILES };
}

export interface RemoteSpec { o: string; n: string; ref: string; token: string; isPrivate: boolean; vendor: boolean; blobs: Blob[] }
// raw downloads don't spend API quota, so public repos read every file for free
export function remoteEntries({ o, n, ref, token, isPrivate, blobs }: RemoteSpec): Entry[] {
  const gh = client(token), rp = ref.split("/").map(encodeURIComponent).join("/"), enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");
  const read = async (p: string) => {
    const r = isPrivate ? await gh.api(`/repos/${o}/${n}/contents/${enc(p)}?ref=${encodeURIComponent(ref)}`, "application/vnd.github.raw+json") : await fetch(`${API.raw}/${o}/${n}/${rp}/${enc(p)}`);
    if (!r.ok) throw new Error("file " + r.status);
    return new Uint8Array(await r.arrayBuffer());
  };
  return blobs.map(t => [t.path, { size: t.size, async: () => read(t.path) }]);
}

type StepFn = (id: string, state: "run" | "done", note?: string, frac?: number) => void;
interface AnalyzeArgs { o: string; n: string; ref?: string; token: string; vendor: boolean; signal?: AbortSignal; onStep?: StepFn; count: (s: RemoteSpec, onProgress: (done: number, all: number) => void) => Promise<CountResult> }
export async function analyzeRepo({ o, n, ref: wantRef, token, vendor, signal, count, onStep = () => {} }: AnalyzeArgs): Promise<Report> {
  const gh = client(token, signal), base = `/repos/${o}/${n}`;
  onStep("meta", "run");
  const r = await gh.api(base);
  if (gh.limited(r)) throw new RateLimitError(+r.headers.get("x-ratelimit-reset")!);
  if (r.status === 404) throw new Error("That repository wasn’t found. Check the spelling, or add a token if it’s private.");
  if (!r.ok) throw new Error(`GitHub returned an error (${r.status}). Try again in a moment.`);
  const m: GhRepo = await r.json(), ref = wantRef || m.default_branch || "main";
  onStep("meta", "done"); onStep("tree", "run");
  const { blobs, truncated, capped } = await listBlobs(gh, o, n, ref);
  onStep("tree", "done", blobs.length.toLocaleString("en-US") + " files"); onStep("count", "run");
  const C = await count({ o, n, ref, token, isPrivate: !!m.private, vendor, blobs }, (done, all) => onStep("count", "run", `${done.toLocaleString("en-US")} of ${all.toLocaleString("en-US")} files`, done / all));
  onStep("count", "done"); onStep("stats", "run");
  const [commits, who, rels, prs, act, growth, punch, authors, comm, closed, open] = await Promise.all([
    gh.count(base + "/commits?sha=" + encodeURIComponent(ref)), gh.list<GhContributor>(base + "/contributors?anon=1"), gh.list<GhRelease>(base + "/releases"),
    gh.json<{ total_count: number }>(`/search/issues?q=repo:${o}/${n}+type:pr+state:open&per_page=1`).then(j => j ? j.total_count : null),
    gh.stats<WeekActivity>(base + "/stats/commit_activity"), gh.stats<CodeFreq>(base + "/stats/code_frequency"), gh.stats<Punch>(base + "/stats/punch_card"), gh.stats<AuthorStat>(base + "/stats/contributors"),
    gh.json<Community>(base + "/community/profile"),
    gh.json<any[]>(base + "/issues?state=closed&per_page=100&sort=updated"), gh.json<any[]>(base + "/issues?state=open&per_page=100&sort=updated&direction=asc")
  ]);
  onStep("stats", "done");
  const pending = Object.entries({ act, growth, punch, authors }).filter(([, v]) => !v).map(([k]) => k);
  const contribs = who.more ? await gh.count(base + "/contributors?anon=1") : who.count;
  return {
    ...C, o, n, m, ref, vendor, truncated, capped, commits, contribs, prs, act: act || weeklyFromAuthors(authors), growth, punch, authors, comm, missing: rate.remaining === 0, pending,
    who: who.items.filter(c => c.login), rel: rels.items.map(({ tag_name, published_at, created_at, prerelease }) => ({ tag_name, published_at, created_at, prerelease })), releases: rels.more ? (rels.count ?? 0) + 1 : rels.count,
    issues: closed && open ? [...closed, ...open].map(slimIssue) : null
  };
}

const STATS: Record<string, string> = { act: "commit_activity", growth: "code_frequency", punch: "punch_card", authors: "contributors" };
// GitHub can take a minute to prepare statistics, so the report opens first and these arrive after it
export async function backfillStats({ o, n, token, keys, signal }: { o: string; n: string; token: string; keys: string[]; signal?: AbortSignal }) {
  const gh = client(token, signal), out: Partial<Pick<Report, "act" | "growth" | "punch" | "authors">> = {};
  await Promise.all(keys.map(async k => { const v = await gh.stats<any>(`/repos/${o}/${n}/stats/${STATS[k]}`, 3); if (v) (out as any)[k] = v; }));
  return out;
}

export async function deepCommits({ o, n, ref, token, limit, signal, onProgress }: { o: string; n: string; ref: string; token: string; limit: number; signal?: AbortSignal; onProgress?: (a: number, b: number) => void }): Promise<DeepCommit[]> {
  const gh = client(token, signal), base = `/repos/${o}/${n}`;
  const shas = ((await gh.json<any[]>(`${base}/commits?per_page=${Math.min(limit, 100)}&sha=${encodeURIComponent(ref)}`, [])) || []).map(c => c.sha as string);
  const out: DeepCommit[] = []; let i = 0, done = 0;
  const worker = async () => {
    while (i < shas.length) {
      const j = await gh.json<any>(`${base}/commits/${shas[i++]}`);
      if (j && j.files && (j.parents || []).length < 2) out.push({ sha: j.sha, author: j.author ? j.author.login : (j.commit.author && j.commit.author.name), at: j.commit.author && j.commit.author.date, files: j.files.map((f: any) => ({ path: f.filename, add: f.additions, del: f.deletions })) });
      onProgress && onProgress(++done, shas.length);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return out;
}

// GitHub stamps each star, so sampling evenly spaced pages draws the whole curve cheaply
export async function starHistory({ o, n, token, stars, samples = 10, signal }: { o: string; n: string; token: string; stars: number; samples?: number; signal?: AbortSignal }): Promise<StarHistory> {
  const gh = client(token, signal), PER = 100, pages = Math.min(400, Math.ceil(stars / PER)) || 1;
  const picks = [...new Set(Array.from({ length: Math.min(samples, pages) }, (_, i) => 1 + Math.round(i * (pages - 1) / Math.max(1, Math.min(samples, pages) - 1))))];
  const res = await Promise.all(picks.map(async p => {
    const j = await gh.json<any[]>(`/repos/${o}/${n}/stargazers?per_page=${PER}&page=${p}`, null, "application/vnd.github.star+json");
    return j && j[0] ? { at: new Date(j[0].starred_at).getTime(), stars: (p - 1) * PER + 1 } : null;
  }));
  const pts = res.filter((x): x is { at: number; stars: number } => !!x).sort((a, b) => a.at - b.at);
  pts.push({ at: Date.now(), stars });
  return { pts, capped: stars > 40000 };
}

export async function profileData({ user, token, signal }: { user: string; token: string; signal?: AbortSignal }): Promise<ProfileData> {
  const gh = client(token, signal);
  const r = await gh.api(`/users/${user}`);
  if (gh.limited(r)) throw new RateLimitError(+r.headers.get("x-ratelimit-reset")!);
  if (r.status === 404) throw new Error(`No GitHub user or organization is named ${user}.`);
  if (!r.ok) throw new Error(`GitHub returned an error (${r.status}). Try again in a moment.`);
  const info = await r.json(); let repos: ProfileData["repos"] = [];
  for (let pg = 1; pg <= 3; pg++) {
    const j = (await gh.json<ProfileData["repos"]>(`/users/${user}/repos?per_page=100&sort=pushed&page=${pg}`, [])) || [];
    repos = repos.concat(j); if (j.length < 100) break;
  }
  return { info, repos };
}

export async function readFile({ o, n, ref, path, token, isPrivate, signal }: { o: string; n: string; ref: string; path: string; token: string; isPrivate?: boolean; signal?: AbortSignal }) {
  const enc = path.split("/").map(encodeURIComponent).join("/");
  const r: Response = isPrivate
    ? await client(token, signal).api(`/repos/${o}/${n}/contents/${enc}?ref=${encodeURIComponent(ref)}`, "application/vnd.github.raw+json")
    : await fetch(`${API.raw}/${o}/${n}/${ref.split("/").map(encodeURIComponent).join("/")}/${enc}`, { signal });
  if (!r.ok) throw new Error("This file couldn’t be loaded (" + r.status + ").");
  return r.text();
}

export async function pullRequest({ o, n, num, token, signal }: { o: string; n: string; num: string; token: string; signal?: AbortSignal }) {
  const gh = client(token, signal), base = `/repos/${o}/${n}/pulls/${num}`;
  const r = await gh.api(base);
  if (gh.limited(r)) throw new RateLimitError(+r.headers.get("x-ratelimit-reset")!);
  if (r.status === 404) throw new Error("That pull request wasn’t found. Check the link, or add a token if the repository is private.");
  if (!r.ok) throw new Error(`GitHub returned an error (${r.status}). Try again in a moment.`);
  const pr: PrInfo = await r.json();
  const [files, reviews] = await Promise.all([gh.json<PrFile[]>(base + "/files?per_page=100", []), gh.json<PrReview[]>(base + "/reviews?per_page=100", [])]);
  return { pr, files: files || [], reviews: reviews || [] };
}

// compares manifest versions against the registries. Only direct dependencies, so lock files are left out.
export async function checkOutdated(deps: DepManifest[], { signal }: { signal?: AbortSignal } = {}) {
  const list = deps.filter(x => !x.exact || x.ecosystem === "Go").filter(x => x.ecosystem === "npm" || x.ecosystem === "PyPI").flatMap(x => x.names.filter(n => x.vers[n]).map(name => ({ name, version: x.vers[name], ecosystem: x.ecosystem }))).slice(0, 80);
  const rows: OutdatedRow[] = []; let i = 0, checked = 0;
  const worker = async () => {
    while (i < list.length) {
      const t = list[i++];
      try {
        const r = await fetch(t.ecosystem === "npm" ? `${API.npm}/${t.name.replace("/", "%2F")}/latest` : `${API.pypi}/${encodeURIComponent(t.name)}/json`, { signal });
        if (!r.ok) continue;
        const j = await r.json(), latest = t.ecosystem === "npm" ? j.version : j.info.version, gap = behind(t.version, latest);
        checked++; if (gap) rows.push({ ...t, latest, gap });
      } catch (e) { rethrow(e); }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return { checked, rows: rows.sort((a, b) => b.gap - a.gap) };
}

export async function scanVulns(targets: ScanTarget[], { signal, onProgress }: { signal?: AbortSignal; onProgress?: (a: number, b: number) => void } = {}): Promise<VulnReport> {
  const items = targets.slice(0, 1000);
  const r = await fetch(API.osv + "/v1/querybatch", { method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ queries: items.map(t => ({ package: { name: t.name, ecosystem: t.ecosystem }, version: t.version })) }) });
  if (!r.ok) throw new Error("OSV.dev returned an error (" + r.status + ").");
  const { results } = await r.json();
  const hits: { id: string; pkg: ScanTarget }[] = []; results.forEach((x: any, i: number) => (x.vulns || []).forEach((v: any) => hits.push({ id: v.id, pkg: items[i] })));
  const ids = [...new Set(hits.map(h => h.id))].slice(0, 80), details = new Map<string, ReturnType<typeof summarizeVuln>>();
  let k = 0, done = 0;
  const worker = async () => {
    while (k < ids.length) {
      const id = ids[k++];
      try { const d = await fetch(`${API.osv}/v1/vulns/${encodeURIComponent(id)}`, { signal }); if (d.ok) details.set(id, summarizeVuln(await d.json())); } catch (e) { rethrow(e); }
      onProgress && onProgress(++done, ids.length);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  const rows: VulnRow[] = hits.filter(h => details.has(h.id)).map(h => ({ ...details.get(h.id)!, pkg: h.pkg }));
  return { checked: items.length, approx: items.filter(t => !t.exact).length, total: new Set(hits.map(h => h.id)).size, affected: new Set(hits.map(h => h.pkg.ecosystem + h.pkg.name)).size, rows: rows.sort((a, b) => b.rank - a.rank) };
}
