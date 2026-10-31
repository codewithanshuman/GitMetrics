import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { motion } from "motion/react";
import { useApp } from "../app/App";
import { deepLimit, dropCache, errorText, isLimit, loadRepo, remember, sessionPut, toggleWatch, watchNames, type RepoSpec } from "../app/analysis";
import { backfillStats, checkOutdated, deepCommits, scanVulns, starHistory } from "../core/github";
import { deepStats, scanTargets, summarize, weeklyFromAuthors } from "../core/metrics";
import type { Report } from "../core/types";
import { date } from "../lib/util";
import { EXPORTS, exportAs, type ExportKind } from "../lib/exports";
import { Failure, Loading, useSteps } from "./Loading";
import { Activity, Arch, Code, Flow, Overview, People, Risk } from "./Panels";

export const TABS: [string, string][] = [["overview", "Overview"], ["code", "Code"], ["arch", "Architecture"], ["activity", "Activity"], ["people", "People"], ["flow", "Flow"], ["risk", "Risk"]];
const NAV: Record<string, ReactNode> = {
  overview: <><circle cx="9" cy="9" r="7" /><circle cx="9" cy="9" r="2.500" /></>, code: <path d="M6 5 2 9l4 4M12 5l4 4-4 4" />,
  arch: <><circle cx="4" cy="4" r="2" /><circle cx="14" cy="5" r="2" /><circle cx="9" cy="14" r="2" /><path d="M6 4.300 12 4.700M5 6l3 6.200M13 7l-3 5.200" /></>,
  activity: <path d="M1 9h4l2-6 4 12 2-6h4" />, people: <><circle cx="9" cy="6" r="3" /><path d="M3 16c0-3.500 2.500-5 6-5s6 1.500 6 5" /></>,
  flow: <path d="M2 5h10l-3-3M16 13H6l3 3" />, risk: <><path d="M9 2 16 5v5c0 3.500-3 5.500-7 6-4-.5-7-2.500-7-6V5z" /><path d="M9 6v4M9 12.500v.01" /></>
};
const STEPS: [string, string][] = [["meta", "Reading repository details"], ["tree", "Listing files"], ["count", "Counting lines in a background thread"], ["stats", "Collecting history, people and issues"]];

export function RepoPage({ spec, local, initialTab, tabRef }: { spec?: RepoSpec; local?: Report; initialTab: string; tabRef: MutableRefObject<(t: string) => void> }) {
  const { token, vendor, home, setCurrent } = useApp(), { steps, step } = useSteps();
  const [d, setD] = useState<Report | null>(local || null), [error, setError] = useState<{ msg: string; limited: boolean } | null>(null), [tab, setTabState] = useState(initialTab), [nonce, setNonce] = useState(0), [printing, setPrinting] = useState(false);
  const ab = useRef<AbortController>();

  useEffect(() => {
    if (!spec) return;
    const ctl = new AbortController(); ab.current = ctl; setD(null); setError(null);
    loadRepo(spec, token, vendor, step, ctl.signal).then(r => {
      if (ctl.signal.aborted) return;
      if (!r.history) remember(r);
      r.watched = watchNames().includes(r.m.full_name);
      setD(r);
      if (!r.pending?.length) return;
      // GitHub can take a minute to prepare statistics, so the report opens first and fills in live
      const keys = r.pending; r.pending = []; setD({ ...r, syncing: true });
      backfillStats({ o: r.o, n: r.n, token, keys, signal: ctl.signal }).then(got => {
        const next: Report = { ...r, ...got, syncing: false };
        if (!got.act && got.authors && !r.act) next.act = weeklyFromAuthors(got.authors);
        if (r.key) sessionPut(r.key, next);
        if (!ctl.signal.aborted) setD(next);
      }).catch(() => { if (!ctl.signal.aborted) setD({ ...r, syncing: false }); });
    }).catch(e => { if (e.name === "AbortError") return; setError({ msg: errorText(e, "collecting data"), limited: isLimit(e) }); });
    return () => ctl.abort();
  }, [spec?.o, spec?.n, spec?.ref, nonce]);

  const S = useMemo(() => d ? summarize(d) : null, [d]);
  useEffect(() => { setCurrent(d); return () => setCurrent(null); }, [d, setCurrent]);
  useEffect(() => { if (d) document.title = `${d.m.full_name} · GitMetrics`; }, [d?.m.full_name]);
  useEffect(() => { if (printing) { print(); setPrinting(false); } }, [printing]);

  const tabs = d?.local ? TABS.filter(([k]) => ["overview", "code", "arch", "risk"].includes(k)) : TABS;
  const setTab = (t: string) => {
    if (!tabs.some(([k]) => k === t)) return;
    setTabState(t); window.scrollTo(0, 0);
    if (spec) history.replaceState(null, "", `#${spec.o}/${spec.n}${spec.ref ? "@" + spec.ref : ""}${t !== "overview" ? "~" + t : ""}`);
  };
  tabRef.current = setTab;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target as Element).tagName) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector("dialog[open]")) return;
      const n = +e.key; if (n >= 1 && n <= tabs.length) setTab(tabs[n - 1][0]);
    };
    document.addEventListener("keydown", key); return () => document.removeEventListener("keydown", key);
  });

  if (error) return <Failure msg={error.msg} limited={error.limited} />;
  if (!d || !S) return <Loading title={spec ? `${spec.o}/${spec.n}` : "Report"} steps={STEPS} state={steps} onCancel={home} />;

  const patch = (x: Partial<Report>) => setD(r => { const n = { ...r!, ...x }; if (n.key) sessionPut(n.key, n); return n; });
  const signal = ab.current?.signal;
  const actions = {
    deep: async (p: (a: number, b: number) => void) => { const c = await deepCommits({ o: d.o, n: d.n, ref: d.ref, token, limit: deepLimit(token), signal, onProgress: p }); if (!c.length) throw new Error("GitHub returned no commit details. The rate limit may have run out."); patch({ deep: deepStats(c, d.files) }); },
    scan: async (p: (a: number, b: number) => void) => patch({ vulns: await scanVulns(scanTargets(d.deps), { signal, onProgress: p }) }),
    outdated: async () => patch({ outdated: await checkOutdated(d.deps, { signal }) }),
    stars: async () => patch({ starHist: await starHistory({ o: d.o, n: d.n, token, stars: d.m.stargazers_count || 0, signal }) })
  };
  const m = d.m, risks = S.findings.filter(f => f.level === "risk").length;
  const stale = m.pushed_at && (Date.now() - new Date(m.pushed_at).getTime()) / 864e5 > 365;
  const status = d.local ? ["local", "Local"] : m.archived ? ["off", "Archived"] : stale ? ["warn", "Dormant"] : ["on", "Active"];
  const panel = (k: string) => {
    const p = { d, S, actions, setTab, token };
    return k === "overview" ? <Overview {...p} /> : k === "code" ? <Code {...p} /> : k === "arch" ? <Arch {...p} /> : k === "activity" ? <Activity {...p} /> : k === "people" ? <People {...p} /> : k === "flow" ? <Flow {...p} /> : <Risk {...p} />;
  };
  const doExport = (x: ExportKind) => x === "pdf" ? setPrinting(true) : exportAs(x, d, S);

  return <div className="page">
    <header className="head">
      {m.owner && <img src={`${m.owner.avatar_url}&s=104`} alt="" width="52" height="52" />}
      <div>
        <h1>{d.local ? m.full_name : <a href={m.html_url} target="_blank" rel="noopener"><span>{d.o} / </span>{d.n}</a>}</h1>
        {m.description && <p>{m.description}</p>}
        <div className="meta"><span className={"st " + status[0]}><i />{status[1]}</span>{d.syncing && <span className="st sync"><i />Syncing history</span>}{d.local ? <span>Counted on this device</span> : <><span className="mono">{d.ref}</span>{m.license && <span>{m.license.spdx_id}</span>}{m.created_at && <span>Created {date(m.created_at)}</span>}{m.fork && <span>Fork</span>}{m.private && <span>Private</span>}</>}</div>
      </div>
      <div className="headact">
        {!d.local && <><button className="btn" aria-pressed={!!d.watched} onClick={() => patch({ watched: toggleWatch(m.full_name) })}>{d.watched ? "Watching" : "Watch"}</button><button className="btn" onClick={() => { dropCache(d); setNonce(x => x + 1); }}>Refresh</button></>}
        <details className="menu"><summary className="btn pri">Export</summary><div>{EXPORTS.filter(([k]) => k !== "hbadge" || S.health).map(([k, l]) => <button key={k} onClick={e => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; doExport(k); }}>{l}</button>)}</div></details>
      </div>
    </header>
    <nav className="rail" role="tablist" aria-label="Report sections">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={k === tab} onClick={() => setTab(k)}>{k === tab && <motion.b layoutId="tabpill" className="pill-bg" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{NAV[k]}</svg><span>{l}</span>{k === "overview" && risks > 0 && <em>{risks}</em>}</button>)}</nav>
    {d.missing && <div className="alert warn"><p>GitHub’s rate limit ran out during this analysis, so some sections are missing. Add a token in Settings, then refresh.</p></div>}
    {printing ? tabs.map(([k]) => <div key={k} role="tabpanel">{panel(k)}</div>) : <div key={tab} role="tabpanel" className="enter">{panel(tab)}</div>}
  </div>;
}
