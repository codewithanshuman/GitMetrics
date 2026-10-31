import { useRef, useState, type DragEvent } from "react";
import { useApp } from "../app/App";
import { recents, watchlist } from "../app/analysis";
import { compact } from "../lib/util";
import { Sparkline } from "../ui/charts";
import { PixelEdge, PixelIcon } from "../ui/parts";

const mascot = import.meta.env.BASE_URL + "octocat.png";
const DESK: [string, string, string, string][] = [["folder", "Code map", "6%", "16%"], ["chart", "Health", "11%", "60%"], ["bomb", "Secrets", "4%", "38%"], ["lens", "Architecture", "86%", "14%"], ["floppy", "Reports", "89%", "42%"], ["trash", "Tech debt", "83%", "66%"]];

const FEATS = [["Architecture map", "See how every file connects, with circular imports flagged."], ["Health score", "One grade from six dimensions, with every input shown."], ["Source scan", "Finds leaked secrets, risky calls and TODO debt."], ["Vulnerability scan", "Checks dependencies against the OSV.dev database."], ["Pull request review", "Paste a PR link for an instant risk assessment."], ["Private by design", "Runs in your browser. Your code never reaches our servers."]];

const SKIP = /^(node_modules|\.git|dist|build|vendor|__pycache__|\.next)$/;
async function walk(en: FileSystemEntry, base: string, out: { path: string; file: File }[]) {
  if (en.isFile) { const f = await new Promise<File>((ok, no) => (en as FileSystemFileEntry).file(ok, no)); out.push({ path: base + en.name, file: f }); return; }
  if (SKIP.test(en.name)) return;
  const rd = (en as FileSystemDirectoryEntry).createReader();
  for (;;) { const b = await new Promise<FileSystemEntry[]>((ok, no) => rd.readEntries(ok, no)); if (!b.length) break; for (const c of b) await walk(c, base + en.name + "/", out); }
}

export function Landing() {
  const { go, analyzeLocal } = useApp(), [q, setQ] = useState(""), [over, setOver] = useState(false), zip = useRef<HTMLInputElement>(null), dir = useRef<HTMLInputElement | null>(null);
  const watch = watchlist(), rec = recents();
  const fromZip = (file: File) => analyzeLocal({ kind: "zip", file, name: file.name.replace(/\.zip$/i, "") });
  const drop = async (e: DragEvent) => {
    e.preventDefault(); setOver(false);
    const it = [...e.dataTransfer.items].map(i => i.webkitGetAsEntry()).filter((x): x is FileSystemEntry => !!x), f0 = e.dataTransfer.files[0];
    if (!it.length) return;
    if (it[0].isFile && /\.zip$/i.test(it[0].name)) return fromZip(f0);
    const out: { path: string; file: File }[] = []; for (const en of it) await walk(en, "", out);
    analyzeLocal({ kind: "files", files: out, name: it[0].name });
  };
  return <div className="land">
    <section className="hero">
      {DESK.map(([icon, label, x, y]) => <div key={label} className="desk" style={{ left: x, top: y }}><PixelIcon name={icon} /><span>{label}</span></div>)}
      <div className="sky">
    <h1>See what’s really inside any repo</h1>
    <div className="paperwin"><p className="lede">Architecture, health, security and team dynamics for any GitHub repository, in about a minute. <mark>No sign-in and no server.</mark></p></div>
    <form className="bigform" onSubmit={e => { e.preventDefault(); go(q); }}><span className="pre">github.com/</span><input autoFocus aria-label="Repository, as owner/name, a GitHub URL, a pull request link, or @user" placeholder="owner/repo, a pull request link, or @user" autoComplete="off" spellCheck={false} required value={q} onChange={e => setQ(e.target.value)} /><button className="btn pri">Analyze</button></form>
    <div className="chips">{[["pallets/flask", "pallets/flask"], ["expressjs/express", "expressjs/express"], ["Compare both", "pallets/flask expressjs/express"], ["@pallets", "@pallets"]].map(([l, v]) => <button key={v} className="chip" onClick={() => go(v)}>{l}</button>)}</div>
      </div>
      <img className="mascot" src={mascot} alt="" />
      <PixelEdge />
    </section>
    <div className="land-in">
    <div className={"drop" + (over ? " on" : "")} role="group" aria-label="Analyze local code" onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}>
      <span>Or drop a .zip or folder here. It’s counted on this device and nothing is uploaded.</span>
      <button className="btn sm" onClick={() => zip.current!.click()}>Choose .zip</button><button className="btn sm" onClick={() => dir.current!.click()}>Choose folder</button>
      <input ref={zip} type="file" accept=".zip" hidden aria-label="Choose a zip file" onChange={e => e.target.files?.[0] && fromZip(e.target.files[0])} />
      <input ref={el => { dir.current = el; el?.setAttribute("webkitdirectory", ""); }} type="file" hidden aria-label="Choose a folder" onChange={e => { const fl = e.target.files; if (fl?.length) analyzeLocal({ kind: "files", files: [...fl].map(f => ({ path: f.webkitRelativePath || f.name, file: f })), name: (fl[0].webkitRelativePath || "folder").split("/")[0] }); }} />
    </div>
    {watch.length > 0 && <section className="recent"><h2>Watchlist</h2><div className="rgrid">{watch.map(r => <button key={r.name} className="rcard" onClick={() => go(r.name)}><div><strong>{r.name}</strong><small>{r.health != null ? `health ${r.health}` : "not scored"}{r.lines != null ? ` · ${compact(r.lines)} lines` : ""}</small></div>{r.series && r.series.length > 1 && <Sparkline values={r.series} />}</button>)}</div></section>}
    {rec.length > 0 && <section className="recent"><h2>Recent</h2><div className="rgrid">{rec.map(r => <button key={r.name} className="rcard" onClick={() => go(r.name)}><div><strong>{r.name}</strong><small>{r.lines != null ? compact(r.lines) + " lines" : ""}{r.grade ? ` · grade ${r.grade}` : ""}</small></div></button>)}</div></section>}
    <div className="feats">{FEATS.map(([t, d]) => <div key={t}><h3>{t}</h3><p>{d}</p></div>)}</div>
  </div></div>;
}
