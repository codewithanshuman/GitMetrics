import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../app/App";
import { readFile } from "../core/github";
import { summarize } from "../core/metrics";
import type { Report } from "../core/types";
import { fmt } from "../lib/util";

const MAX = 800;
export function FileDrawer({ path, d, onClose, onOpen }: { path: string; d: Report; onClose: () => void; onOpen: (p: string) => void }) {
  const { token } = useApp(), ref = useRef<HTMLDialogElement>(null), S = useMemo(() => summarize(d), [d]), f = d.files.find(x => x.path === path);
  const [src, setSrc] = useState<string | null>(null), [err, setErr] = useState("");
  useEffect(() => { const el = ref.current!; if (!el.open) el.showModal(); el.scrollTop = 0; }, [path]);
  useEffect(() => {
    setSrc(null); setErr("");
    if (d.local) { setErr("Source preview is available for GitHub repositories."); return; }
    const ab = new AbortController();
    readFile({ o: d.o, n: d.n, ref: d.ref, path, token, isPrivate: d.m.private, signal: ab.signal }).then(setSrc, e => { if (e.name !== "AbortError") setErr(e.message); });
    return () => ab.abort();
  }, [path, d, token]);
  if (!f) { onClose(); return null; }
  const g = S.arch, out = g.neighbors[path] || [], inn = Object.entries(g.neighbors).filter(([, v]) => v.includes(path)).map(([k]) => k);
  const hot = d.deep?.hot.find(h => h.path === path), notes = S.flags.filter(x => x.path === path), hidden = new Set(notes.filter(x => x.kind === "secret").map(x => x.line));
  const Link = ({ p }: { p: string }) => <button className="chip" onClick={() => onOpen(p)}>{p.split("/").pop()}</button>;
  const lines = src?.split("\n");
  return <dialog id="drawer" ref={ref} aria-label="File inspector" onClose={onClose} onClick={e => { if (e.target === ref.current) ref.current!.close(); }}>
    <header><div><h2>{path.split("/").pop()}</h2><p className="mono sub">{path}</p></div><button className="icon" onClick={() => ref.current!.close()} aria-label="Close">×</button></header>
    <div className="dstats"><div><b>{fmt(f.lines)}</b>Lines</div><div><b>{fmt(f.br || 0)}</b>Branches</div><div><b>{fmt(inn.length)}</b>Imported by</div><div><b>{hot ? hot.commits : "–"}</b>Recent commits</div></div>
    <p className="meta"><span>{f.lang}</span>{f.test && <span>Test file</span>}{f.todo > 0 && <span>{f.todo} debt notes</span>}{!d.local && <a href={`${d.m.html_url}/blob/${d.ref}/${path}`} target="_blank" rel="noopener">Open on GitHub</a>}</p>
    {notes.length > 0 && <div className="alert"><p>{notes.length} scan {notes.length === 1 ? "finding" : "findings"}: {notes.slice(0, 3).map(n => `${n.name} on line ${n.line}`).join(", ")}.</p></div>}
    {inn.length > 0 && <><h3>Imported by</h3><div className="chips left">{inn.slice(0, 14).map(p => <Link key={p} p={p} />)}</div></>}
    {out.length > 0 && <><h3>Imports</h3><div className="chips left">{out.slice(0, 14).map(p => <Link key={p} p={p} />)}</div></>}
    <h3>Source</h3>
    <pre className="src">{err || !lines ? (err || "Loading…") : <>{lines.slice(0, MAX).map((l, i) => <span key={i} className={"ln" + (hidden.has(i + 1) ? " hit" : "")}><i>{i + 1}</i>{hidden.has(i + 1) ? <em>Hidden: flagged by the source scan</em> : l || " "}</span>)}{lines.length > MAX && <span className="ln"><i />Showing the first {MAX} of {fmt(lines.length)} lines.</span>}</>}</pre>
  </dialog>;
}
