import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Command } from "cmdk";
import { rate } from "../core/github";
import { summarize } from "../core/metrics";
import type { Report } from "../core/types";
import { fmt, runCount, store } from "../lib/util";
import { exportAs, report as mdReport } from "../lib/exports";
import { Logo } from "../ui/parts";
import { inputToHash, readHash, recents, watchNames, type Route } from "./analysis";
import { FileDrawer } from "../pages/FileDrawer";
import { Landing } from "../pages/Landing";
import { RepoPage, TABS } from "../pages/RepoPage";
import { ComparePage } from "../pages/ComparePage";
import { ProfilePage } from "../pages/ProfilePage";
import { PrPage } from "../pages/PrPage";
import { Loading, Failure, useSteps } from "../pages/Loading";

interface Ctx {
  token: string; vendor: boolean; go: (input: string) => void; home: () => void; openSettings: () => void;
  setCurrent: (d: Report | null) => void; setTab: (t: string) => void; analyzeLocal: (job: LocalJob) => void; theme: string; toggleTheme: () => void;
}
export type LocalJob = { kind: "zip"; file: File; name: string } | { kind: "files"; files: { path: string; file: File }[]; name: string };
const AppCtx = createContext<Ctx>(null!);
export const useApp = () => useContext(AppCtx);

function Tooltip() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const tip = ref.current!, t = (e.target as Element).closest?.("[data-tip]") as HTMLElement | null;
      if (!t) { tip.hidden = true; return; }
      tip.textContent = t.dataset.tip!; tip.hidden = false;
      const r = tip.getBoundingClientRect();
      tip.style.left = Math.min(innerWidth - r.width - 8, Math.max(8, e.clientX + 12)) + "px";
      tip.style.top = (e.clientY - r.height - 12 < 8 ? e.clientY + 16 : e.clientY - r.height - 12) + "px";
    };
    document.addEventListener("pointermove", move);
    return () => document.removeEventListener("pointermove", move);
  }, []);
  return <div ref={ref} className="tip" role="tooltip" hidden />;
}

function Settings({ open, onClose, token, setToken, vendor, setVendor }: { open: boolean; onClose: () => void; token: string; setToken: (t: string, keep: boolean) => void; vendor: boolean; setVendor: (v: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null), [val, setVal] = useState(token), [keep, setKeep] = useState(!!store.get("gm.token", ""));
  useEffect(() => { if (open && !ref.current!.open) ref.current!.showModal(); if (!open && ref.current!.open) ref.current!.close(); }, [open]);
  return <dialog id="settings" ref={ref} onClose={onClose} aria-labelledby="st">
    <form method="dialog" onSubmit={() => setToken(val.trim(), keep)}>
      <h2 id="st">Settings</h2>
      <label>GitHub token<input type="password" autoComplete="off" placeholder="ghp_…" value={val} onChange={e => setVal(e.target.value)} /><span className="sub">Needed for private repositories. Raises the limit from 60 to 5,000 requests an hour, and is only ever sent to GitHub.</span></label>
      <label className="chk"><input type="checkbox" checked={keep} onChange={e => setKeep(e.target.checked)} /> <span>Remember this token in this browser</span></label>
      <label className="chk"><input type="checkbox" checked={vendor} onChange={e => setVendor(e.target.checked)} /> <span>Include vendored, generated and lock files in line counts</span></label>
      <div className="foot"><button className="btn pri">Done</button></div>
    </form>
  </dialog>;
}

function Palette({ open, setOpen, current }: { open: boolean; setOpen: (o: boolean) => void; current: Report | null }) {
  const { go, home, openSettings, setTab, toggleTheme } = useApp(), [q, setQ] = useState("");
  const run = (fn: () => void) => { setOpen(false); setQ(""); fn(); };
  const S = useMemo(() => current ? summarize(current) : null, [current]);
  const hash = inputToHash(q);
  return <Command.Dialog open={open} onOpenChange={setOpen} label="Command palette" className="cmdk" overlayClassName="cmdk-back" contentClassName="cmdk-box">
    <Command.Input value={q} onValueChange={setQ} placeholder="owner/repo, a pull request link, @user, or a command" />
    <Command.List>
      <Command.Empty>Nothing matches. Press Enter on a repository name to analyze it.</Command.Empty>
      {hash && <Command.Item forceMount value={"analyze " + q} onSelect={() => run(() => go(q))}>Analyze {q}<small>Enter</small></Command.Item>}
      {watchNames().length > 0 && <Command.Group heading="Watchlist">{watchNames().map(n => <Command.Item key={n} value={"watch " + n} onSelect={() => run(() => go(n))}>{n}</Command.Item>)}</Command.Group>}
      {recents().length > 0 && <Command.Group heading="Recent">{recents().map(r => <Command.Item key={r.name} value={"recent " + r.name} onSelect={() => run(() => go(r.name))}>{r.name}</Command.Item>)}</Command.Group>}
      {current && <Command.Group heading="Report">{TABS.filter(([k]) => !current.local || ["overview", "code", "arch", "risk"].includes(k)).map(([k, l]) => <Command.Item key={k} value={"go to " + l} onSelect={() => run(() => setTab(k))}>{l}</Command.Item>)}
        {S && <><Command.Item value="copy markdown report" onSelect={() => run(() => navigator.clipboard.writeText(mdReport(current, S)))}>Copy Markdown report</Command.Item><Command.Item value="download share image" onSelect={() => run(() => exportAs("png", current, S))}>Download share image</Command.Item></>}</Command.Group>}
      <Command.Group heading="App"><Command.Item value="go home start" onSelect={() => run(home)}>Go to start</Command.Item><Command.Item value="switch theme dark light" onSelect={() => run(toggleTheme)}>Switch theme</Command.Item><Command.Item value="open settings token" onSelect={() => run(openSettings)}>Open settings</Command.Item></Command.Group>
    </Command.List>
  </Command.Dialog>;
}

export function App() {
  const [route, setRoute] = useState<Route>(readHash), [token, setTokenState] = useState(() => store.get("gm.token", "")), [vendor, setVendorState] = useState(() => store.get("gm.vendor", false));
  const [theme, setTheme] = useState(() => store.get("gm.theme", "light")), [settings, setSettings] = useState(false), [palette, setPalette] = useState(false);
  const [current, setCurrent] = useState<Report | null>(null), [file, setFile] = useState<string | null>(null), [, bump] = useState(0);
  const [local, setLocal] = useState<Report | null>(null), [localJob, setLocalJob] = useState<LocalJob | null>(null), [localError, setLocalError] = useState("");
  const tabSetter = useRef<(t: string) => void>(() => {});
  const { steps, step, reset } = useSteps();

  useEffect(() => { document.documentElement.dataset.theme = theme; store.set("gm.theme", theme); }, [theme]);
  useEffect(() => { rate.onChange = () => bump(x => x + 1); return () => { rate.onChange = null; }; }, []);
  useEffect(() => { const f = () => setRoute(readHash()); window.addEventListener("hashchange", f); return () => window.removeEventListener("hashchange", f); }, []);
  useEffect(() => {
    const click = (e: MouseEvent) => { const t = (e.target as Element).closest?.("[data-file]") as HTMLElement | null; if (t) setFile(t.dataset.file!); };
    const key = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as Element).tagName);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette(o => !o); return; }
      if (typing || e.metaKey || e.ctrlKey || e.altKey || document.querySelector("dialog[open]")) return;
      if (e.key === "/") { e.preventDefault(); setPalette(true); }
    };
    document.addEventListener("click", click); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("click", click); document.removeEventListener("keydown", key); };
  }, []);

  const go = useCallback((input: string) => { const h = inputToHash(input); if (h) location.hash = h; }, []);
  const home = useCallback(() => { setLocal(null); setLocalJob(null); setLocalError(""); history.replaceState(null, "", location.pathname + location.search); setRoute({ kind: "home" }); setCurrent(null); }, []);
  const analyzeLocal = useCallback((job: LocalJob) => {
    setLocal(null); setLocalError(""); setLocalJob(job); reset(); step("count", "run"); setRoute({ kind: "local" });
    const v = store.get("gm.vendor", false);
    runCount(job.kind === "zip" ? { kind: "zip", file: job.file, vendor: v } : { kind: "files", files: job.files, vendor: v }, (a, b) => step("count", "run", `${fmt(a)} of ${fmt(b)} files`, a / b))
      .then(C => { setLocal({ ...C, local: true, ref: "local files", o: "local", n: job.name, m: { full_name: job.name, html_url: "#" }, who: [], rel: [], vendor: v }); setLocalJob(null); })
      .catch(e => { setLocalError(e.message || "Those files couldn’t be read."); setLocalJob(null); });
  }, [reset, step]);

  const ctx: Ctx = useMemo(() => ({
    token, vendor, go, home, openSettings: () => setSettings(true), setCurrent, setTab: t => tabSetter.current(t), analyzeLocal, theme, toggleTheme: () => setTheme(t => t === "dark" ? "light" : "dark")
  }), [token, vendor, go, home, analyzeLocal, theme]);

  const pageKey = route.kind === "repo" ? `repo:${route.spec.o}/${route.spec.n}@${route.spec.ref}` : route.kind === "vs" ? "vs:" + route.list.join() : route.kind === "user" ? "u:" + route.user : route.kind === "pr" ? `pr:${route.o}/${route.n}/${route.num}` : route.kind;
  let page: ReactNode;
  if (route.kind === "repo") page = <RepoPage spec={route.spec} initialTab={route.tab} tabRef={tabSetter} />;
  else if (route.kind === "vs") page = <ComparePage list={route.list} />;
  else if (route.kind === "user") page = <ProfilePage user={route.user} />;
  else if (route.kind === "pr") page = <PrPage o={route.o} n={route.n} num={route.num} />;
  else if (route.kind === "local") page = localError ? <Failure msg={localError} /> : local ? <RepoPage local={local} initialTab="overview" tabRef={tabSetter} /> : <Loading title={localJob?.name || "Local files"} steps={[["count", "Counting lines"]]} state={steps} onCancel={home} />;
  else page = <Landing />;

  const low = rate.remaining != null && rate.remaining < 10;
  return <AppCtx.Provider value={ctx}>
    <header className="top">
      <button className="logo" onClick={home} aria-label="GitMetrics, go to start"><Logo size={22} /><span>GitMetrics</span></button>
      <button className="search" onClick={() => setPalette(true)} aria-label="Search repositories and commands">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="7" cy="7" r="5" /><path d="m11 11 3.500 3.500" /></svg>
        <span>Analyze a repo or run a command</span><kbd>Ctrl K</kbd>
      </button>
      {rate.remaining != null && <div className={"quota" + (low ? " low" : "")} title={`GitHub API requests left this hour: ${rate.remaining} of ${rate.limit}`}><i><b style={{ width: `${rate.remaining / (rate.limit || 60) * 100}%` }} /></i><span>API {fmt(rate.remaining)}/{fmt(rate.limit)}</span></div>}
      <button className="icon" onClick={ctx.toggleTheme} aria-label="Switch theme"><svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="9" cy="9" r="7" /><path d="M9 2a7 7 0 0 1 0 14z" fill="currentColor" /></svg></button>
      <button className="icon" onClick={() => setSettings(true)} aria-label="Settings"><svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M3 5h7M14 5h1M3 13h1M8 13h7" /><circle cx="12" cy="5" r="2" /><circle cx="6" cy="13" r="2" /></svg></button>
    </header>
    <main key={pageKey} className="enter">{page}</main>
    <Tooltip />
    <Palette open={palette} setOpen={setPalette} current={current} />
    <Settings open={settings} onClose={() => setSettings(false)} token={token} vendor={vendor} setVendor={v => { setVendorState(v); store.set("gm.vendor", v); }} setToken={(t, keep) => { setTokenState(t); if (keep && t) store.set("gm.token", t); else store.del("gm.token"); }} />
    {file && current && <FileDrawer path={file} d={current} onClose={() => setFile(null)} onOpen={setFile} />}
  </AppCtx.Provider>;
}
