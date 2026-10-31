// Turns the raw data for a repository into scores, findings and chart-ready series. Pure functions only.
import { NONCODE, cocomo, isTest, langOf } from "./engine";
import { buildGraph } from "./graph";
import type { LabelValue, AuthorStat, Community, DeepCommit, DeepStats, DepManifest, Dimension, FileStat, Finding, FlowStats, Forecast, GhContributor, GhRelease, GhRepo, Health, Issue, LangRow, LangTotals, Level, PeopleStats, PrFile, PrInfo, PrReview, PrStats, ReleaseStats, Report, ScanTarget, Severity, Summary, WeekActivity } from "./types";

const DAY = 864e5;
export const median = (a: number[]) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const percentile = (a: number[], p: number) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const days = (a: string | number, b: string | number) => (new Date(b).getTime() - new Date(a).getTime()) / DAY;

// piecewise-linear score, for example band(x, [[0, 100], [30, 50], [90, 0]])
export function band(x: number, pts: number[][]) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [a, s] = pts[i - 1], [b, t] = pts[i]; return s + (t - s) * (x - a) / (b - a); }
  return pts[pts.length - 1][1];
}
export const grade = (s: number) => s >= 85 ? "A" : s >= 70 ? "B" : s >= 55 ? "C" : s >= 40 ? "D" : "F";
const mean = (a: (number | null)[]) => { const v = a.filter((x): x is number => x != null); return v.length ? v.reduce((t, x) => t + x, 0) / v.length : null; };
export const fmtDur = (d: number | null | undefined) => d == null ? "–" : d < 1 ? ((h: number) => h + (h === 1 ? " hour" : " hours"))(Math.max(1, Math.round(d * 24))) : d < 60 ? d.toFixed(1) + " days" : Math.round(d / 30) + " months";

export function languageRows(langs: Record<string, LangTotals>): LangRow[] {
  return Object.values(langs).map(g => ({ ...g, total: g.code + g.com + g.blank })).sort((a, b) => b.total - a.total);
}

export function busFactor(contributors: Pick<GhContributor, "contributions">[]) {
  const sum = contributors.reduce((t, c) => t + c.contributions, 0);
  if (!sum) return null;
  let acc = 0, n = 0;
  for (const c of [...contributors].sort((a, b) => b.contributions - a.contributions)) { acc += c.contributions; n++; if (acc >= sum / 2) break; }
  return n;
}

export function flowStats(issues: Issue[] | null | undefined, now = Date.now()): FlowStats | null {
  if (!issues) return null;
  const closedI = issues.filter(i => i.closed && !i.pr), merged = issues.filter(i => i.merged), open = issues.filter(i => !i.closed);
  const issueDays = closedI.map(i => days(i.created, i.closed!)), prDays = merged.map(i => days(i.created, i.merged!));
  const BUCKETS: [string, number][] = [["Under 1 week", 7], ["1–4 weeks", 30], ["1–3 months", 90], ["3–12 months", 365], ["Over 1 year", Infinity]];
  const ages = BUCKETS.map(([label]) => ({ label, value: 0 }));
  open.forEach(i => { const a = days(i.created, now); ages[BUCKETS.findIndex(b => a < b[1])].value++; });
  const months: FlowStats["months"][number][] & Record<string, any> = [] as any, key = (d: string) => d.slice(0, 7);
  issues.forEach(i => { if (i.closed) { const g = months[key(i.closed) as any] ||= { month: key(i.closed), issues: 0, prs: 0 }; i.pr ? g.prs++ : g.issues++; } });
  const labels: Record<string, number> = {}; issues.forEach(i => i.labels.forEach(l => labels[l] = (labels[l] || 0) + 1));
  return {
    issueMedian: median(issueDays), issueP90: percentile(issueDays, .9), prMedian: median(prDays), prP90: percentile(prDays, .9),
    stale: open.filter(i => days(i.updated, now) > 90).length, openSample: open.length, closedSample: closedI.length, mergedSample: merged.length,
    unmerged: issues.filter(i => i.pr && i.closed && !i.merged).length,
    ages, months: (Object.values(months) as FlowStats["months"]).sort((a, b) => a.month.localeCompare(b.month)).slice(-12),
    labels: Object.entries(labels).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value }))
  };
}

// who is active now, and how much of the work each person carries, from GitHub's weekly per-author stats
export function peopleStats(authors: AuthorStat[] | null | undefined, now = Date.now()): PeopleStats | null {
  if (!authors) return null;
  const cut = now / 1000 - 90 * 86400, yearCut = now / 1000 - 365 * 86400;
  const list = authors.filter(a => a.author).map(a => {
    const who = a.author!;
    const live = a.weeks.filter(w => w.c);
    return {
      login: who.login, avatar: who.avatar_url, url: who.html_url, total: a.total,
      add: a.weeks.reduce((t, w) => t + w.a, 0), del: a.weeks.reduce((t, w) => t + w.d, 0),
      recent: a.weeks.filter(w => w.w >= cut).reduce((t, w) => t + w.c, 0), year: a.weeks.filter(w => w.w >= yearCut).reduce((t, w) => t + w.c, 0),
      first: live.length ? live[0].w : null, last: live.length ? live[live.length - 1].w : null, spark: a.weeks.slice(-26).map(w => w.c)
    };
  }).sort((x, y) => y.total - x.total);
  const newcomers: Record<string, number> = {};
  list.forEach(p => { if (p.first) { const y = new Date(p.first * 1000).getUTCFullYear(); newcomers[y] = (newcomers[y] || 0) + 1; } });
  const recentTotal = list.reduce((t, p) => t + p.recent, 0);
  return {
    list, active90: list.filter(p => p.recent > 0).length, active365: list.filter(p => p.year > 0).length, recentTotal,
    topShare: recentTotal ? Math.max(...list.map(p => p.recent)) / recentTotal : null,
    newcomers: Object.entries(newcomers).sort((a, b) => +a[0] - +b[0]).slice(-10).map(([label, value]) => ({ label, value }))
  };
}

// a stand-in for commit_activity while GitHub is still computing it. It has weekly totals but no daily split.
export function weeklyFromAuthors(authors: Pick<AuthorStat, "weeks">[] | null | undefined): WeekActivity[] | null {
  if (!authors || !authors.length) return null;
  const byWeek: Record<string, number> = {};
  authors.forEach(a => a.weeks.slice(-52).forEach(w => byWeek[w.w] = (byWeek[w.w] || 0) + w.c));
  return Object.entries(byWeek).sort((a, b) => +a[0] - +b[0]).slice(-52).map(([week, total]) => ({ week: +week, total, days: null }));
}

export function releaseStats(rel: GhRelease[] | null | undefined, now = Date.now()): ReleaseStats {
  const list = (rel || []).map(r => ({ tag: r.tag_name, at: new Date(r.published_at || r.created_at), pre: r.prerelease })).filter(r => !isNaN(r.at.getTime())).sort((a, b) => b.at.getTime() - a.at.getTime());
  const gaps = list.slice(1).map((r, i) => (list[i].at.getTime() - r.at.getTime()) / DAY);
  return { list, cadence: median(gaps), since: list.length ? (now - list[0].at.getTime()) / DAY : null };
}

interface Part { label: string; value: string | null; score: number | null; w: number }
function dimension(key: string, label: string, parts: Part[], desc: string): Dimension {
  const live = parts.filter(p => p.score != null) as (Part & { score: number; value: string })[];
  const score = live.length ? Math.round(live.reduce((t, p) => t + p.score * p.w, 0) / live.reduce((t, p) => t + p.w, 0)) : null;
  return { key, label, desc, score, factors: live.map(({ label, value, score }) => ({ label, value, score: Math.round(score) })) };
}

type CoreSummary = Omit<Summary, "brief" | "findings" | "health">;
interface Ctx { S: CoreSummary; m: GhRepo; act?: WeekActivity[] | null; flow: FlowStats | null; people: PeopleStats | null; bus: number | null; releases: ReleaseStats; comm?: Community | null; now?: number }
export function healthScore({ S, m, act, flow, people, bus, releases, comm, now = Date.now() }: Ctx): Health {
  const weeks = act ? act.filter(w => w.total > 0).length : null;
  const sincePush = m.pushed_at ? days(m.pushed_at, now) : null;
  const dims = [
    dimension("activity", "Activity", [
      { label: "Active weeks in the last year", value: weeks != null ? weeks + " of 52" : null, score: weeks != null ? band(weeks, [[0, 0], [12, 50], [36, 100]]) : null, w: 2 },
      { label: "Last push", value: sincePush != null ? fmtDur(sincePush) + " ago" : null, score: sincePush != null ? band(sincePush, [[14, 100], [90, 70], [365, 20], [730, 0]]) : null, w: 2 }
    ], "How regularly the code changes."),
    dimension("response", "Responsiveness", [
      { label: "Median issue close", value: flow && flow.issueMedian != null ? fmtDur(flow.issueMedian) : null, score: flow && flow.issueMedian != null ? band(flow.issueMedian, [[3, 100], [30, 70], [120, 35], [365, 10]]) : null, w: 2 },
      { label: "Median PR merge", value: flow && flow.prMedian != null ? fmtDur(flow.prMedian) : null, score: flow && flow.prMedian != null ? band(flow.prMedian, [[2, 100], [14, 75], [60, 35], [180, 10]]) : null, w: 2 },
      { label: "Stale open items", value: flow && flow.openSample ? `${flow.stale} of ${flow.openSample}` : null, score: flow && flow.openSample ? band(flow.stale / flow.openSample, [[.1, 100], [.5, 50], [1, 10]]) : null, w: 1 }
    ], "How quickly maintainers answer issues and pull requests."),
    dimension("community", "Community", [
      { label: "GitHub community profile", value: comm ? comm.health_percentage + "%" : null, score: comm ? comm.health_percentage : null, w: 2 },
      { label: "License", value: m.license === undefined ? null : m.license ? m.license.spdx_id : "None", score: m.license === undefined ? null : m.license ? 100 : 0, w: 1 }
    ], "Docs and policies that let others take part."),
    dimension("sustain", "Sustainability", [
      { label: "Bus factor", value: bus != null ? String(bus) : null, score: bus != null ? band(bus, [[1, 25], [2, 55], [3, 75], [5, 100]]) : null, w: 2 },
      { label: "Contributors active in 90 days", value: people ? String(people.active90) : null, score: people ? band(people.active90, [[0, 0], [1, 35], [3, 70], [8, 100]]) : null, w: 2 },
      { label: "Top author’s share of recent commits", value: people && people.topShare != null ? Math.round(people.topShare * 100) + "%" : null, score: people && people.topShare != null ? band(people.topShare, [[.3, 100], [.6, 65], [1, 25]]) : null, w: 1 }
    ], "Whether the project survives if someone leaves."),
    dimension("quality", "Code quality", [
      { label: "Test code share", value: S.testShare != null ? Math.round(S.testShare * 100) + "%" : null, score: S.testShare != null ? band(S.testShare, [[0, 0], [.1, 55], [.25, 100]]) : null, w: 3 },
      { label: "Comments per 100 code lines", value: S.T.code ? (S.T.com / S.T.code * 100).toFixed(0) : null, score: S.T.code ? band(S.T.com / S.T.code, [[0, 20], [.05, 70], [.12, 100], [.4, 100], [.8, 60]]) : null, w: 1 },
      { label: "Duplicated lines", value: S.dup != null ? (S.dup * 100).toFixed(0) + "%" : null, score: S.dup != null ? band(S.dup, [[.05, 100], [.15, 70], [.35, 20]]) : null, w: 2 },
      { label: "Lines in very large files (1,000+)", value: S.hugeShare != null ? Math.round(S.hugeShare * 100) + "%" : null, score: S.hugeShare != null ? band(S.hugeShare, [[.05, 100], [.3, 60], [.7, 15]]) : null, w: 1 }
    ], "Signals from the source itself."),
    dimension("release", "Release hygiene", [
      { label: "Median gap between releases", value: releases.cadence != null ? fmtDur(releases.cadence) : null, score: releases.cadence != null ? band(releases.cadence, [[30, 100], [120, 70], [365, 30]]) : null, w: 1 },
      { label: "Since the last release", value: releases.since != null ? fmtDur(releases.since) : null, score: releases.since != null ? band(releases.since, [[60, 100], [365, 50], [1095, 0]]) : null, w: 1 }
    ], "How predictably users get new versions.")
  ];
  const live = dims.filter(d => d.score != null);
  // a project that doesn't publish releases or lacks data isn't penalized: missing dimensions drop out of the average
  const score = live.length ? Math.round(mean(live.map(d => d.score))!) : null;
  return { score, grade: score != null ? grade(score) : null, dims };
}

export function codeFindings(S: CoreSummary): Finding[] {
  const out: Finding[] = [], leaks = S.flags.filter(f => f.kind === "secret" && f.severity !== "MODERATE");
  if (leaks.length) out.push({ level: "risk", title: `${leaks.length} possible ${leaks.length === 1 ? "secret" : "secrets"} in the source`, detail: `First match: ${leaks[0].name} in ${leaks[0].path}.`, tab: "risk" });
  if (S.arch.cycleCount) out.push({ level: "warn", title: `${S.arch.cycleCount} circular ${S.arch.cycleCount === 1 ? "dependency" : "dependencies"}`, detail: `The largest loop connects ${S.arch.cycles[0].length} files.`, tab: "arch" });
  if (S.arch.hubs[0] && S.arch.hubs[0].in >= Math.max(8, S.arch.files * .25)) out.push({ level: "warn", title: "One file carries much of the codebase", detail: `${S.arch.hubs[0].in} files import ${S.arch.hubs[0].path}.`, tab: "arch" });
  if (S.debtTotal >= 50) out.push({ level: "warn", title: "A large TODO backlog", detail: `${S.debtTotal} TODO, FIXME and HACK notes in the code.`, tab: "risk" });
  return out;
}

export function findings({ S, m, act, flow, people, bus, releases, comm, now = Date.now() }: Ctx): Finding[] {
  const out: Finding[] = [], add = (level: Level, title: string, detail: string, tab: string) => out.push({ level, title, detail, tab });
  if (m.archived) add("risk", "This repository is archived", "It is read-only, so bugs and security problems won’t be fixed here.", "overview");
  if (m.pushed_at) { const d = days(m.pushed_at, now); if (d > 365) add("risk", "No pushes in over a year", `The last push was ${fmtDur(d)} ago.`, "activity"); }
  if (bus === 1 && people && people.list.length > 1) add("risk", "One person wrote half the commits", `If ${people.list[0].login} steps away, most of the history leaves with them.`, "people");
  if (people && people.active90 === 0 && m.pushed_at && !m.archived) add("warn", "No tracked author committed in the last 90 days", "Pushes may be bots or merges only.", "people");
  if (act && act.length >= 26) {
    const sum = (a: WeekActivity[]) => a.reduce((t, w) => t + w.total, 0), last = sum(act.slice(-13)), prev = sum(act.slice(-26, -13));
    if (prev >= 10 && last < prev * .6) add("warn", "Commit activity is falling", `${last} commits in the last 13 weeks, down from ${prev} in the 13 before.`, "activity");
    if (prev >= 5 && last > prev * 1.5) add("good", "Commit activity is rising", `${last} commits in the last 13 weeks, up from ${prev} in the 13 before.`, "activity");
  }
  if (S.testShare === 0 && S.T.code > 500) add("risk", "No test code was found", "No files matched the usual test folders or names.", "code");
  else if (S.testShare != null && S.testShare < .08 && S.T.code > 500) add("warn", "Very little test code", `Tests make up ${(S.testShare * 100).toFixed(1)}% of code lines.`, "code");
  else if (S.testShare != null && S.testShare >= .25) add("good", "Strong test coverage by volume", `Tests make up ${Math.round(S.testShare * 100)}% of code lines. That measures volume, not branch coverage.`, "code");
  if (S.dup != null && S.dup > .25) add("warn", "A lot of duplicated code", `About ${Math.round(S.dup * 100)}% of long lines appear more than once.`, "code");
  if (S.biggest && S.biggest.lines > 3000 && !NONCODE.has(S.biggest.lang)) add("warn", "One very large file", `${S.biggest.path} has ${S.biggest.lines.toLocaleString("en-US")} lines.`, "code");
  if (S.hotspots[0] && S.hotspots[0].br > 200) add("warn", "A branch-heavy hotspot", `${S.hotspots[0].path} has ${S.hotspots[0].br} branch points.`, "code");
  if (flow && flow.openSample >= 20 && flow.stale / flow.openSample > .5) add("warn", "The backlog is going stale", `${flow.stale} of the ${flow.openSample} open items checked have been idle for 90+ days.`, "flow");
  if (flow && flow.prMedian != null && flow.prMedian < 2 && flow.mergedSample >= 10) add("good", "Pull requests merge fast", `Half of recent PRs merged within ${fmtDur(flow.prMedian)}.`, "flow");
  if (m.license === null) add("risk", "No license", "Without a license, others have no right to reuse this code.", "overview");
  if (comm && comm.health_percentage >= 85) add("good", "Complete community profile", `GitHub rates it ${comm.health_percentage}%.`, "overview");
  if (releases.since != null && releases.since > 730 && m.pushed_at && days(m.pushed_at, now) < 90) add("warn", "Active, but releases have stopped", `The last release was ${fmtDur(releases.since)} ago, and code is still changing.`, "activity");
  out.push(...codeFindings(S));
  const rank: Record<Level, number> = { risk: 0, warn: 1, good: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

export function summarize(d: Pick<Report, "langs" | "files" | "dup" | "m" | "who" | "rel"> & Partial<Report>, now = Date.now()): Summary {
  const rows = languageRows(d.langs);
  const T = rows.reduce((s, g) => ({ files: s.files + g.files, code: s.code + g.code, com: s.com + g.com, blank: s.blank + g.blank }), { files: 0, code: 0, com: 0, blank: 0 });
  const total = T.code + T.com + T.blank, files = d.files;
  const source = files.filter(f => !NONCODE.has(f.lang));
  const tl = source.filter(f => f.test).reduce((t, f) => t + f.lines, 0), pl = source.filter(f => !f.test).reduce((t, f) => t + f.lines, 0);
  const huge = source.filter(f => f.lines >= 1000).reduce((t, f) => t + f.lines, 0);
  const fd: Record<string, Summary["folders"][number]> = {};
  files.forEach(f => { const k = f.path.includes("/") ? f.path.split("/")[0] + "/" : "(root files)"; const g = fd[k] ||= { name: k, files: 0, lines: 0 }; g.files++; g.lines += f.lines; });
  const S: any = {
    rows, T, total, dup: d.dup ?? null, testShare: pl + tl ? tl / (pl + tl) : null, tl, pl, hugeShare: pl + tl ? huge / (pl + tl) : null,
    folders: Object.values(fd).sort((a, b) => b.lines - a.lines), effort: cocomo(T.code),
    biggest: [...files].sort((a, b) => b.lines - a.lines)[0],
    hotspots: files.filter(f => f.br && f.lines >= 40).sort((a, b) => b.br - a.br).slice(0, 10)
  };
  S.arch = buildGraph(files);
  S.flags = d.flags || []; S.debt = d.debt || []; S.debtTotal = S.debt.length;
  S.debtTags = ["TODO", "FIXME", "HACK", "XXX"].map((label: string) => ({ label, value: S.debt.filter((x: { tag: string }) => x.tag === label).length })).filter((x: LabelValue) => x.value);
  if (d.local) return { ...S, local: true, findings: codeFindings(S), health: null, brief: brief(d, S) };
  const flow = flowStats(d.issues, now), people = peopleStats(d.authors, now), releases = releaseStats(d.rel, now), bus = busFactor(d.who || []);
  const ctx = { S, m: d.m, act: d.act, flow, people, bus, releases, comm: d.comm, now };
  const out = { ...S, flow, people, releases, bus, health: healthScore(ctx), findings: findings(ctx), yearCommits: d.act ? d.act.reduce((t, w) => t + w.total, 0) : null, activeWeeks: d.act ? d.act.filter(w => w.total > 0).length : null, forecast: forecast(d.act) };
  out.brief = brief(d, out);
  return out;
}

// a least-squares line through recent weeks, projected a quarter ahead
export function forecast(act: Pick<WeekActivity, "total">[] | null | undefined, weeks = 26, ahead = 13): Forecast | null {
  if (!act || act.length < 8) return null;
  const y = act.slice(-weeks).map(w => w.total), n = y.length, mx = (n - 1) / 2, my = y.reduce((t, v) => t + v, 0) / n;
  let a = 0, b = 0; y.forEach((v, i) => { a += (i - mx) * (v - my); b += (i - mx) ** 2; });
  const slope = a / b, at = (i: number) => Math.max(0, my + slope * (i - mx));
  const next = Array.from({ length: ahead }, (_, i) => at(n + i)).reduce((t, v) => t + v, 0), last = y.slice(-ahead).reduce((t, v) => t + v, 0);
  return { slope: +slope.toFixed(3), next: Math.round(next), last, change: last ? (next - last) / last : null, trend: Math.abs(slope) < .02 * Math.max(my, 1) ? "steady" : slope > 0 ? "rising" : "falling" };
}

const short = (n: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
export function brief(d: { m: GhRepo; local?: boolean }, S: any): string {
  const lang = (S.rows.find((g: LangRow) => !NONCODE.has(g.name)) || S.rows[0] || {}).name, name = d.m.full_name, out: string[] = [];
  out.push(`${name} is a ${lang || "mixed"} codebase of ${short(S.total)} lines across ${short(S.T.files)} files, built with an estimated ${S.effort.personMonths < 1 ? "less than a person-month" : short(S.effort.personMonths) + " person-months"} of work.`);
  if (d.local) { if (S.arch.linked) out.push(`${S.arch.linked} files are linked by ${S.arch.edgeCount} internal imports.`); return out.join(" "); }
  if (S.health && S.health.score != null) {
    const live = S.health.dims.filter((x: Dimension) => x.score != null).sort((a: any, b: any) => b.score - a.score), hi = live[0], lo = live[live.length - 1];
    out.push(`It scores ${S.health.score} out of 100 (grade ${S.health.grade}), strongest on ${hi.label.toLowerCase()} and weakest on ${lo.label.toLowerCase()}.`);
  }
  if (S.forecast) out.push(`Commit activity is ${S.forecast.trend}, with about ${S.forecast.next} commits projected for the next quarter.`);
  const risks = S.findings.filter((f: Finding) => f.level === "risk");
  out.push(risks.length ? `The first thing to check: ${risks[0].title.toLowerCase()}.` : "No serious risks stood out.");
  return out.join(" ");
}

const SENSITIVE = /(^|\/)(\.github\/workflows\/|dockerfile|migrations?\/)|auth|secret|security|password|crypt|payment|\.lock$|lock\.(json|ya?ml)$|go\.sum$/i;
export function prStats(pr: Pick<PrInfo, "state" | "created_at"> & Partial<PrInfo>, files: PrFile[], reviews: PrReview[] = [], now = Date.now()): PrStats {
  const changed = files.reduce((t, f) => t + f.additions + f.deletions, 0);
  const size = changed < 10 ? "XS" : changed < 100 ? "S" : changed < 400 ? "M" : changed < 1000 ? "L" : "XL";
  const src = files.filter(f => !isTest(f.filename) && !NONCODE.has(langOf(f.filename.split("/").pop()!)[0])), tests = files.filter(f => isTest(f.filename));
  const sensitive = files.filter(f => SENSITIVE.test(f.filename));
  const latest: Record<string, string> = {}; reviews.forEach(r => { if (r.user) latest[r.user.login] = r.state; });
  const approved = Object.values(latest).filter(s => s === "APPROVED").length, blocked = Object.values(latest).filter(s => s === "CHANGES_REQUESTED").length;
  const srcLines = src.reduce((t, f) => t + f.additions + f.deletions, 0);
  const noTests = srcLines > 20 && !tests.length;
  const notes: PrStats["notes"] = [], note = (level: Level, title: string, detail: string) => notes.push({ level, title, detail });
  if (changed >= 1000) note("risk", "Very large change", `${changed.toLocaleString("en-US")} lines is hard to review well. Consider splitting it.`);
  else if (changed >= 400) note("warn", "Large change", `${changed.toLocaleString("en-US")} lines changed across ${files.length} files.`);
  if (noTests) note("warn", "No tests changed", `${srcLines} lines of source changed with no test file touched.`);
  else if (tests.length) note("good", "Tests included", `${tests.length} test ${tests.length === 1 ? "file" : "files"} changed.`);
  if (sensitive.length) note("warn", "Touches sensitive files", sensitive.slice(0, 3).map(f => f.filename).join(", ") + (sensitive.length > 3 ? ` and ${sensitive.length - 3} more` : "") + ".");
  if (blocked) note("risk", "Changes requested", `${blocked} ${blocked === 1 ? "reviewer has" : "reviewers have"} requested changes.`);
  if (approved) note("good", "Approved", `${approved} ${approved === 1 ? "reviewer has" : "reviewers have"} approved.`);
  else if (pr.state === "open" && !blocked) note("warn", "No approval yet", "Nobody has approved this pull request.");
  if (pr.mergeable_state === "dirty") note("risk", "Merge conflicts", "This branch conflicts with its base.");
  const score = Math.round(Math.min(100, band(changed, [[10, 5], [100, 20], [400, 45], [1000, 70], [3000, 90]]) + (noTests ? 15 : 0) + Math.min(sensitive.length * 5, 15) + (blocked ? 10 : 0) - (approved ? 10 : 0)));
  const langs: Record<string, number> = {}; files.forEach(f => { const l = langOf(f.filename.split("/").pop()!)[0]; langs[l] = (langs[l] || 0) + f.additions + f.deletions; });
  return { changed, size, score: Math.max(0, score), level: score >= 65 ? "High" : score >= 35 ? "Medium" : "Low", approved, blocked, tests: tests.length, sensitive: sensitive.length, notes, age: days(pr.created_at, pr.merged_at || pr.closed_at || now), langs: Object.entries(langs).filter(e => e[1]).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value })) };
}

const major = (v: unknown) => parseInt(String(v), 10);
export function behind(cur: string, latest: string) { const a = major(cur), b = major(latest); return Number.isNaN(a) || Number.isNaN(b) ? null : Math.max(0, b - a); }

// churn, coupling and ownership from a sample of recent commits with their file lists
export function deepStats(commits: DeepCommit[], files: Pick<FileStat, "path" | "br" | "lines" | "lang">[] = []): DeepStats {
  const churn: Record<string, { path: string; commits: number; add: number; del: number; authors: Set<string> }> = {}, pairs: Record<string, number> = {}, owners: Record<string, Record<string, number>> = {};
  const known = new Map(files.map(f => [f.path, f]));
  for (const c of commits) {
    const who = c.author || "unknown", list = c.files.filter(f => known.size === 0 || known.has(f.path));
    for (const f of list) {
      const g = churn[f.path] ||= { path: f.path, commits: 0, add: 0, del: 0, authors: new Set() };
      g.commits++; g.add += f.add; g.del += f.del; g.authors.add(who);
      const dir = f.path.includes("/") ? f.path.split("/")[0] + "/" : "(root files)", o = owners[dir] ||= {};
      o[who] = (o[who] || 0) + 1;
    }
    // sweeping commits (formatters, renames) say nothing about real coupling
    if (list.length > 1 && list.length <= 20) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) { const k = [list[i].path, list[j].path].sort().join("\u0000"); pairs[k] = (pairs[k] || 0) + 1; }
  }
  const hot: DeepStats["hot"] = Object.values(churn).map(g => { const f = known.get(g.path); return { ...g, authors: g.authors.size, br: f ? f.br : 0, lines: f ? f.lines : 0, lang: f ? f.lang : "Other", risk: 0 }; });
  const maxC = Math.max(1, ...hot.map(h => h.commits)), maxB = Math.max(1, ...hot.map(h => h.br));
  hot.forEach(h => h.risk = Math.round(Math.sqrt(h.commits / maxC * (h.br / maxB)) * 100));
  const coupling = Object.entries(pairs).filter(([, n]) => n >= 2).map(([k, n]) => { const [a, b] = k.split("\u0000"); return { a, b, n, ratio: n / Math.min(churn[a].commits, churn[b].commits) }; }).sort((x, y) => y.n * y.ratio - x.n * x.ratio).slice(0, 12);
  const ownership = Object.entries(owners).map(([dir, o]) => { const e = Object.entries(o).sort((a, b) => b[1] - a[1]), tot = e.reduce((t, x) => t + x[1], 0); return { dir, owner: e[0][0], share: e[0][1] / tot, touches: tot, authors: e.length }; }).sort((a, b) => b.touches - a.touches).slice(0, 12);
  return { sample: commits.length, hot: hot.sort((a, b) => b.risk - a.risk || b.commits - a.commits), coupling, ownership };
}

// unique packages to check, preferring exact lock file versions over manifest ranges
export function scanTargets(deps: DepManifest[]): ScanTarget[] {
  const seen = new Map<string, ScanTarget>();
  for (const d of [...deps].sort((a, b) => +b.exact - +a.exact)) for (const name of d.names) {
    const k = d.ecosystem + ":" + name, version = d.vers[name];
    if (version && !seen.has(k)) seen.set(k, { ecosystem: d.ecosystem, name, version, exact: d.exact });
  }
  return [...seen.values()];
}

const SEV: Record<string, number> = { CRITICAL: 4, HIGH: 3, MODERATE: 2, MEDIUM: 2, LOW: 1 };
export function summarizeVuln(v: any) {
  const sev = String((v.database_specific && v.database_specific.severity) || "").toUpperCase();
  const fixes = (v.affected || []).flatMap((a: any) => (a.ranges || []).flatMap((r: any) => (r.events || []).map((e: any) => e.fixed))).filter(Boolean) as string[];
  return { id: v.id, alias: (v.aliases || []).find((a: string) => a.startsWith("CVE-")) || "", summary: v.summary || (v.details || "").split("\n")[0].slice(0, 140), severity: (SEV[sev] ? (sev === "MEDIUM" ? "MODERATE" : sev) : "UNRATED") as Severity, rank: SEV[sev] || 0, fixed: fixes[fixes.length - 1] || "" };
}

// squarified treemap layout: items need .v, returns copies with x, y, w, h
export interface Rect { x: number; y: number; w: number; h: number }
export function squarify<T extends { v: number }>(items: T[], x: number, y: number, w: number, h: number): (T & Rect)[] {
  const out: (T & Rect)[] = [], list = items.filter(i => i.v > 0).sort((a, b) => b.v - a.v);
  const total = list.reduce((t, i) => t + i.v, 0);
  if (!total || w <= 0 || h <= 0) return out;
  const scale = w * h / total;
  let i = 0;
  while (i < list.length) {
    const side = Math.min(w, h), row: T[] = [];
    let sum = 0, worst = Infinity;
    while (i + row.length < list.length) {
      const a = list[i + row.length].v * scale, s = sum + a, lo = Math.min(a, row.length ? row[row.length - 1].v * scale : a), hi = row.length ? row[0].v * scale : a;
      const next = Math.max(side * side * hi / (s * s), s * s / (side * side * lo));
      if (next > worst) break;
      worst = next; sum = s; row.push(list[i + row.length]);
    }
    const t = sum / side;
    let off = 0;
    for (const it of row) {
      const len = it.v * scale / t;
      out.push(w >= h ? { ...it, x, y: y + off, w: t, h: len } : { ...it, x: x + off, y, w: len, h: t });
      off += len;
    }
    if (w >= h) { x += t; w -= t; } else { y += t; h -= t; }
    i += row.length;
  }
  return out;
}

export interface TreeFile { name: string; path: string; v: number; lang: string }
export interface TreeDir { name: string; path: string; v: number; dirs: Record<string, TreeDir>; files: TreeFile[]; lang: Record<string, number> }
export function fileTree(files: Pick<FileStat, "path" | "lines" | "lang">[]): TreeDir {
  const root: TreeDir = { name: "", path: "", v: 0, dirs: {}, files: [], lang: {} };
  for (const f of files) {
    if (!f.lines) continue;
    const parts = f.path.split("/"); let n = root; n.v += f.lines;
    parts.slice(0, -1).forEach((p, i) => { n = n.dirs[p] ||= { name: p, path: parts.slice(0, i + 1).join("/"), v: 0, dirs: {}, files: [], lang: {} }; n.v += f.lines; n.lang[f.lang] = (n.lang[f.lang] || 0) + f.lines; });
    n.files.push({ name: parts[parts.length - 1], path: f.path, v: f.lines, lang: f.lang });
  }
  return root;
}
