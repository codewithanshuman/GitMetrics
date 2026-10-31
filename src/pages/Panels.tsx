// The sections of a repository report.
import { useDeferredValue, useMemo, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { deepLimit } from "../app/analysis";
import { forceLayout } from "../core/graph";
import { fileTree, fmtDur, scanTargets, squarify, type Rect, type TreeDir } from "../core/metrics";
import { parseQuery } from "../core/scan";
import type { Report, Summary } from "../core/types";
import { compact, date, fmt, monthYear, pct } from "../lib/util";
import { ArchMap, Area, Columns, Diverging, HBars, Heatmap, HeatScale, Hive, PunchCard, Quadrant, Ring, SERIES, Sparkline, slot } from "../ui/charts";
import { Card, Empty, FindingRow, LangStrip, Num, Path, SevPill, Tile, colorMap, tintMap } from "../ui/parts";

type Progress = (a: number, b: number) => void;
export interface PanelProps { d: Report; S: Summary; token: string; setTab: (t: string) => void; actions: { deep: (p: Progress) => Promise<void>; scan: (p: Progress) => Promise<void>; outdated: () => Promise<void>; stars: () => Promise<void> } }

function Action({ label, busy, run, pri }: { label: string; busy: string; run: (p: Progress) => Promise<void>; pri?: boolean }) {
  const [state, setState] = useState<string | null>(null), [err, setErr] = useState("");
  return <><button className={"btn" + (pri ? " pri" : "")} disabled={!!state} onClick={() => { setErr(""); setState(busy); run((a, b) => setState(`${busy} ${a} of ${b}`)).catch(e => { if (e.name !== "AbortError") setErr(e.message || "That request failed."); }).finally(() => setState(null)); }}>{state || (err ? "Try again" : label)}</button>{err && <p className="note">{err}</p>}</>;
}

export function Overview({ d, S, setTab }: PanelProps) {
  const m = d.m, h = S.health, fl = S.findings, hist = d.history;
  const change = (now?: number | null, was?: number | null): ReactNode => was == null || now == null || now === was ? null : <> <b>{now > was ? "+" : "−"}{fmt(Math.abs(now - was))}</b> since last visit</>;
  const grown = useMemo(() => { if (!d.growth) return null; let c = 0; return d.growth.slice(-52).map(w => c += w[1] + w[2]); }, [d.growth]);
  const hasDays = !!d.act?.[0]?.days, core = h && h.score != null;
  const board = (S.people ? S.people.list.map(p => ({ login: p.login, avatar: p.avatar, url: p.url, n: p.total })) : d.who.map(c => ({ login: c.login!, avatar: c.avatar_url!, url: c.html_url!, n: c.contributions }))).slice(0, 5);
  return <>
    {d.since && <p className="since">{d.since}</p>}
    <section className="card brief"><h2>The brief</h2><p>{S.brief}</p></section>
    <dl className="tiles">
      <Tile k="Lines" v={compact(S.total)} sub={<>{fmt(S.T.files)} files{hist && change(S.total, hist.lines)}</>} spark={grown && <Sparkline values={grown} />} />
      <Tile k="Code" v={compact(S.T.code)} sub={pct(S.T.code, S.total, 0) + " of all lines"} />
      {!d.local && <Tile k="Commits" v={compact(d.commits)} sub={S.yearCommits != null ? `${fmt(S.yearCommits)} in the last year` : ""} spark={d.act && <Sparkline values={d.act.map(w => w.total)} />} />}
      {!d.local && <Tile k="Contributors" v={compact(d.contribs)} sub={S.bus != null ? `bus factor ${S.bus}` : ""} />}
      {!d.local && <Tile k="Stars" v={compact(m.stargazers_count)} sub={<>{compact(m.forks_count)} forks{hist && change(m.stargazers_count, hist.stars)}</>} />}
      <Tile k="Estimated effort" v={S.effort.personMonths < 10 ? S.effort.personMonths + " pm" : fmt(Math.round(S.effort.personMonths)) + " pm"} sub={`about $${compact(S.effort.cost)}, rough COCOMO`} />
    </dl>
    <div className="grid gap">
      {hasDays ? <Card c={core ? "c8" : "c12"} title="Activity" sub="Commits · last 12 months"><div className="scroll"><div style={{ minWidth: 640 }}><Heatmap act={d.act!} /></div></div><HeatScale /></Card>
        : d.act ? <Card c={core ? "c8" : "c12"} title="Activity" sub="Commits per week · last 12 months"><Columns h={170} label="Commits per week over the last year" data={d.act.map(w => ({ label: monthYear(w.week * 1000), value: w.total, tip: `Week of ${date(w.week * 1000)}: ${w.total} commits` }))} /></Card> : null}
      {core && <Card c={"core " + (d.act ? "c4" : "c12")} title="Health" sub="Hover a row for its inputs"><Ring score={h.score!} grade={h.grade!} /><div className="dims">{h.dims.filter(x => x.score != null).map(x => <div className="dim" key={x.key} data-tip={x.desc + "\n" + x.factors.map(f => `${f.label}: ${f.value} (${f.score})`).join("\n")}><span>{x.label}</span><u><i style={{ width: `${x.score}%` }} /></u><b>{x.score}</b></div>)}</div></Card>}
      <Card c={"core " + (d.local ? "c12" : "c4")} title="Code hive" sub="One cell per file. Warmest cells have the most branches."><Hive files={d.files} /><div className="hfoot"><div><b>{S.testShare != null ? Math.round(S.testShare * 100) + "%" : "–"}</b>Tests</div><div><b>{pct(S.T.com, S.T.code, 0)}</b>Comments</div><div><b>{S.dup != null ? Math.round(S.dup * 100) + "%" : "–"}</b>Duplicated</div></div></Card>
      {!d.local && <Card c="c4" title="Leaderboard" sub="Top authors by commits"><div className="board">{board.map((p, i) => <div key={p.login}><b>#{i + 1}</b><img src={`${p.avatar}&s=52`} alt="" loading="lazy" width="26" height="26" /><a href={p.url} target="_blank" rel="noopener">{p.login}</a><small>{compact(p.n)}</small></div>)}{!board.length && <Empty>No contributor data yet.</Empty>}</div></Card>}
      {!d.local && <Card c="c4" title="Findings" sub={fl.length ? `${fl.filter(f => f.level === "risk").length} risks, ${fl.filter(f => f.level === "warn").length} to look at, ${fl.filter(f => f.level === "good").length} strengths` : "Nothing stood out"}><div className="flist">{fl.slice(0, 5).map(f => <FindingRow key={f.title} f={f} onOpen={setTab} />)}{!fl.length && <Empty>No rule fired for this repository.</Empty>}</div></Card>}
      <Card c="c12" title="Languages" sub="Share of lines, without vendored or generated files"><LangStrip rows={S.rows} total={S.total} /></Card>
    </div>
  </>;
}

function Treemap({ d, S }: { d: Report; S: Summary }) {
  const tree = useMemo(() => fileTree(d.files), [d.files]), [path, setPath] = useState<string[]>([]), tints = tintMap(S.rows), W = 1200, H = 600;
  let node = tree; for (const p of path) node = node.dirs[p] || node;
  const fill = (lang?: string) => (lang && tints[lang]) || "var(--t8)", dom = (n: TreeDir) => Object.entries(n.lang).sort((a, b) => b[1] - a[1])[0]?.[0];
  const trim = (s: string, w: number) => { const c = Math.floor((w - 10) / 6.4); return s.length > c ? s.slice(0, Math.max(0, c - 1)) + "…" : s; };
  type Item = { v: number; name: string; path: string; dir?: TreeDir; lang?: string };
  const items = (n: TreeDir): Item[] => [...Object.values(n.dirs).map(x => ({ v: x.v, name: x.name, path: x.path, dir: x, lang: dom(x) })), ...n.files];
  const box = (r: Rect) => ({ x: r.x, y: r.y, width: r.w, height: r.h });
  return <>
    <div className="crumbs">{["root", ...path].map((p, i, a) => i === a.length - 1 ? <span key={i}>{p}</span> : <span key={i}><button onClick={() => setPath(path.slice(0, i))}>{p}</button> / </span>)}</div>
    <div className="tmap"><svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Treemap of ${path.join("/") || "the repository"}, sized by lines and colored by language`}>
      {squarify(items(node).slice(0, 400), 0, 0, W, H).map(r => {
        if (!r.dir) return <g key={r.path}><rect className="tile-f" {...box(r)} fill={fill(r.lang)} data-file={r.path} data-tip={`${r.path}\n${fmt(r.v)} lines, ${r.lang}`} />{r.w > 56 && r.h > 22 && <text x={r.x + 8} y={r.y + 18}>{trim(r.name, r.w)}</text>}{r.w > 56 && r.h > 52 && <text x={r.x + r.w - 8} y={r.y + r.h - 8} textAnchor="end">{compact(r.v)}</text>}</g>;
        const head = r.h > 44 && r.w > 60 ? 19 : 0, inner = squarify(items(r.dir), r.x + 1, r.y + head + 1, r.w - 2, r.h - head - 2);
        return <g key={r.path} className="dir" role="button" tabIndex={0} aria-label={`Open folder ${r.path}, ${fmt(r.v)} lines`} onClick={() => setPath(r.path.split("/"))} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPath(r.path.split("/")); } }}><rect {...box(r)} fill="var(--surface)" />{inner.map(i => <rect key={i.path} {...box(i)} fill={fill(i.lang)} data-tip={`${i.path}\n${fmt(i.v)} lines`} />)}{head > 0 && <text className="dn" x={r.x + 6} y={r.y + 14}>{trim(r.name + "/", r.w)}</text>}</g>;
      })}
    </svg></div>
    <ul className="legend">{S.rows.filter(g => g.name !== "Other").slice(0, SERIES - 1).map(g => <li key={g.name}><em style={{ background: tints[g.name] }} />{g.name}</li>)}<li><em style={{ background: "var(--t8)" }} />Other</li></ul>
  </>;
}

function Files({ d, S }: { d: Report; S: Summary }) {
  const [q, setQ] = useState(""), [lang, setLang] = useState(""), [sort, setSort] = useState("lines"), dq = useDeferredValue(q), box = useRef<HTMLDivElement>(null);
  const hit = useMemo(() => { const match = parseQuery(dq); return d.files.filter(f => (!lang || f.lang === lang) && match(f)).sort(sort === "path" ? (a, b) => a.path.localeCompare(b.path) : sort === "br" ? (a, b) => (b.br || 0) - (a.br || 0) : (a, b) => b.lines - a.lines); }, [d.files, dq, lang, sort]);
  const v = useVirtualizer({ count: hit.length, getScrollElement: () => box.current, estimateSize: () => 36, overscan: 12 });
  return <>
    <div className="filters"><input type="search" placeholder="Try: lang:python lines:>200 test:false src/" aria-label="Filter files with a query" autoComplete="off" value={q} onChange={e => setQ(e.target.value)} /><select aria-label="Filter by language" value={lang} onChange={e => setLang(e.target.value)}><option value="">All languages</option>{S.rows.map(g => <option key={g.name}>{g.name}</option>)}</select><select aria-label="Sort files" value={sort} onChange={e => setSort(e.target.value)}><option value="lines">Sort by lines</option><option value="br">Sort by branches</option><option value="path">Sort by path</option></select></div>
    <div className="vhead"><span>Path</span><span>Language</span><span>Code</span><span>Lines</span></div>
    <div className="vbox" ref={box}><div style={{ height: v.getTotalSize(), position: "relative" }}>{v.getVirtualItems().map(r => { const f = hit[r.index]; return <div key={f.path} className="vrow" data-file={f.path} style={{ transform: `translateY(${r.start}px)` }}><span className="vpath" title={f.path}>{f.path}</span><span>{f.lang}</span><span>{fmt(f.code)}</span><span>{fmt(f.lines)}</span></div>; })}</div>{!hit.length && <Empty>No files match that query.</Empty>}</div>
    <p className="note">{fmt(hit.length)} of {fmt(d.files.length)} files match. Query fields: lang, path, lines, code, branches, todo, imports, test. Select a file to inspect it.</p>
  </>;
}

export function Code({ d, S }: PanelProps) {
  const colors = colorMap(S.rows), rows = S.rows, top = rows[0].total, T = S.T;
  return <>
    <dl className="tiles">
      <Tile k="Comments" v={pct(T.com, T.code)} sub={`${fmt(T.com)} lines, per code line`} />
      <Tile k="Blank lines" v={pct(T.blank, S.total)} sub={fmt(T.blank) + " lines"} />
      <Tile k="Test code" v={S.testShare != null ? pct(S.tl, S.tl + S.pl) : null} sub={S.pl ? `${Math.round(S.tl / S.pl * 100)} test lines per 100 production lines` : ""} />
      <Tile k="Duplicated" v={S.dup != null ? (S.dup * 100).toFixed(1) + "%" : null} sub="long lines repeated, approximate" />
      <Tile k="Average file" v={fmt(Math.round(S.total / Math.max(T.files, 1)))} sub="lines per file" />
      <Tile k="Languages" v={fmt(rows.length)} />
    </dl>
    <div className="grid gap">
      <Card c="c12" title="Code map" sub="Each block is a file sized by lines. Select a folder to zoom in, or a file to inspect it."><Treemap d={d} S={S} /></Card>
      <Card c="c7" title="By language"><div className="scroll"><table><thead><tr><th>Language</th><th>Files</th><th>Code</th><th>Comments</th><th>Blank</th><th>Total</th><th /></tr></thead><tbody>{rows.slice(0, 20).map(g => <tr key={g.name}><td><span className="lswatch" style={{ background: colors[g.name] || "var(--rest)" }} />{g.name}</td><Num>{fmt(g.files)}</Num><Num>{fmt(g.code)}</Num><Num>{fmt(g.com)}</Num><Num>{fmt(g.blank)}</Num><Num>{fmt(g.total)}</Num><td className="bar"><div style={{ width: `${g.total / top * 100}%`, background: colors[g.name] || "var(--rest)" }} /></td></tr>)}</tbody></table></div></Card>
      <Card c="c5" title="By top-level folder"><div className="scroll"><table><thead><tr><th>Folder</th><th>Files</th><th>Lines</th><th>Share</th></tr></thead><tbody>{S.folders.slice(0, 12).map(g => <tr key={g.name}><td className="mono">{g.name}</td><Num>{fmt(g.files)}</Num><Num>{fmt(g.lines)}</Num><Num>{pct(g.lines, S.total)}</Num></tr>)}</tbody></table></div></Card>
      {S.hotspots.length > 0 && <Card c="c12" title="Most branch-heavy files" sub="Files with many decision points are usually the hardest to test and change" note="Branches count if, for, while, case, catch, && and || in each file."><div className="scroll"><table><thead><tr><th>File</th><th>Branches</th><th>Per 100 lines</th><th>Lines</th></tr></thead><tbody>{S.hotspots.map(f => <tr key={f.path}><Path p={f.path} /><Num>{fmt(f.br)}</Num><Num>{(f.br / f.lines * 100).toFixed(0)}</Num><Num>{fmt(f.lines)}</Num></tr>)}</tbody></table></div></Card>}
      <Card c="c12" title="Files" note={<>Counted at <b>{d.ref}</b>. {fmt(d.skipped)} vendored, generated or lock files {d.vendor ? "were included" : "were left out"}, and {fmt(d.binary)} binary or oversized files were skipped. Comment counts follow each language’s syntax, so treat them as close estimates.{d.failed ? ` ${fmt(d.failed)} files couldn’t be fetched and aren’t counted.` : ""}{d.truncated ? " GitHub returned a partial file list for this very large repository, so totals are incomplete." : ""}{d.capped ? " Only the first 12,000 files were read, so totals are incomplete." : ""}</>}><Files d={d} S={S} /></Card>
    </div>
  </>;
}

export function Arch({ d, S }: PanelProps) {
  const g = S.arch, pos = useMemo(() => g.linked ? forceLayout(g) : [], [g]);
  if (!g.linked) return <div className="card"><Empty>No internal imports were found. The map supports JavaScript, TypeScript, Python, Go, Rust, C, C++, Java, Kotlin, Scala and Ruby.</Empty></div>;
  const groups = Object.entries(g.nodes.reduce<Record<string, number>>((t, n) => (t[n.group] = (t[n.group] || 0) + 1, t), {})).sort((a, b) => b[1] - a[1]).map(x => x[0]);
  const colorOf = (k: string) => { const i = groups.indexOf(k); return i < SERIES - 1 ? slot(i) : "var(--rest)"; };
  const List = ({ rows, c }: { rows: typeof g.hubs; c: "in" | "out" }) => <div className="scroll"><table><thead><tr><th>File</th><th>{c === "in" ? "Imported by" : "Imports"}</th><th>Lines</th></tr></thead><tbody>{rows.map(h => <tr key={h.path}><Path p={h.path} /><Num>{fmt(h[c])}</Num><Num>{fmt(h.lines)}</Num></tr>)}</tbody></table></div>;
  return <>
    <dl className="tiles">
      <Tile k="Connected files" v={fmt(g.linked)} sub={`of ${fmt(g.files)} production files`} />
      <Tile k="Internal imports" v={fmt(g.edgeCount)} sub={`about ${(g.edgeCount / Math.max(g.linked, 1)).toFixed(1)} per file`} />
      <Tile k="Circular dependencies" v={fmt(g.cycleCount)} sub={g.cycleCount ? "loops to untangle" : "none found"} />
      <Tile k="Top hub" v={g.hubs[0] ? fmt(g.hubs[0].in) : "–"} sub={g.hubs[0] ? `files import ${g.hubs[0].path.split("/").pop()}` : ""} />
    </dl>
    <div className="grid gap">
      <Card c="c12" title="Architecture map" sub="Each dot is a file and each line is an import. Hover to trace links, or select a dot to inspect it." note={g.shown < g.linked ? `Showing the ${g.shown} most connected of ${fmt(g.linked)} files. Test files are left out.` : "Test files are left out."}><div className="archwrap"><ArchMap g={g} pos={pos} colorOf={colorOf} /></div><ul className="legend">{groups.slice(0, SERIES - 1).map(k => <li key={k}><em style={{ background: colorOf(k) }} />{k}</li>)}{groups.length >= SERIES && <li><em style={{ background: "var(--rest)" }} />Other</li>}{g.edges.some(e => e.cycle) && <li><em style={{ background: "var(--pop)" }} />Circular import</li>}</ul></Card>
      {g.cycleCount > 0 && <Card c="c12" title="Circular dependencies" sub="These files depend on each other in a loop, which makes them hard to change or test alone">{g.cycles.map((c, i) => <div className="loop" key={i}><b>Loop {i + 1}</b>{c.slice(0, 8).map(p => <button key={p} className="chip" data-file={p}>{p.split("/").pop()}</button>)}{c.length > 8 && <span className="sub">and {c.length - 8} more</span>}</div>)}</Card>}
      {g.hubs.length > 0 && <Card c="c6" title="Most depended on" sub="A change here reaches the most code"><List rows={g.hubs} c="in" /></Card>}
      {g.heavy.length > 0 && <Card c="c6" title="Most dependent" sub="These files know about the most others"><List rows={g.heavy} c="out" /></Card>}
      {g.external.length > 0 && <Card c="c12" title="Top external modules" sub="How many files import each one"><HBars items={g.external} label="External modules by importing files" /></Card>}
    </div>
  </>;
}

export function Activity({ d, S, actions }: PanelProps) {
  const R = S.releases!, gr = d.growth && d.growth.length > 3 ? d.growth : null;
  const growth = useMemo(() => {
    if (!gr) return null;
    let c = 0; const cum = gr.map(w => c += w[1] + w[2]), scale = S.total / Math.max(cum[cum.length - 1], 1), step = Math.max(1, Math.floor(gr.length / 160));
    return cum.map((v, i) => ({ v, i })).filter(x => x.i % step === 0 || x.i === cum.length - 1).map(({ v, i }) => { const n = Math.round(Math.max(v, 0) * scale); return { label: monthYear(gr[i][0] * 1000), value: n, tip: `${date(gr[i][0] * 1000)}: about ${fmt(n)} lines` }; });
  }, [gr, S.total]);
  return <>
    <dl className="tiles">
      <Tile k="Commits, last year" v={S.yearCommits != null ? fmt(S.yearCommits) : null} sub={S.activeWeeks != null ? `active in ${S.activeWeeks} of 52 weeks` : ""} />
      <Tile k="Last push" v={d.m.pushed_at ? fmtDur((Date.now() - new Date(d.m.pushed_at).getTime()) / 864e5) : null} sub="ago" />
      <Tile k="Releases" v={d.releases != null ? fmt(d.releases) : null} sub={R.since != null ? `last ${fmtDur(R.since)} ago` : "none published"} />
      <Tile k="Release cadence" v={R.cadence != null ? fmtDur(R.cadence) : null} sub="median gap" />
      {S.forecast && <Tile k="Next quarter, projected" v={fmt(S.forecast.next)} sub={`commits, ${S.forecast.trend} (a simple trend line)`} />}
    </dl>
    <div className="grid gap">
      {d.act?.[0]?.days ? <Card c="c12" title="Daily commits" sub="Last 52 weeks"><div className="scroll"><div style={{ minWidth: 640 }}><Heatmap act={d.act} /></div></div><HeatScale /></Card>
        : d.act ? <Card c="c12" title="Commits per week" sub="Last 52 weeks. The daily view appears when GitHub finishes preparing it."><Columns h={170} label="Commits per week" data={d.act.map(w => ({ label: monthYear(w.week * 1000), value: w.total, tip: `Week of ${date(w.week * 1000)}: ${w.total} commits` }))} /></Card>
          : <Card c="c12"><Empty>{d.syncing ? "GitHub is preparing activity statistics. They’ll appear here when ready." : "GitHub hasn’t prepared activity statistics yet. Refresh in a minute."}</Empty></Card>}
      {gr && <Card c="c7" title="Lines changed per week" sub="Last 52 weeks"><Diverging data={gr.slice(-52)} label="Lines added and deleted per week" /><ul className="legend"><li><em style={{ background: "var(--s1)" }} />Added</li><li><em style={{ background: "var(--s2)" }} />Deleted</li></ul></Card>}
      {d.punch && <Card c="c5" title="When commits happen" sub="By weekday and hour, UTC"><div className="scroll"><div style={{ minWidth: 460 }}><PunchCard pc={d.punch} /></div></div></Card>}
      {growth && <Card c="c12" title="Growth" sub="All history" note={`An estimate built from GitHub’s weekly additions and deletions, scaled to today’s ${fmt(S.total)} lines.`}><Area data={growth} label="Estimated lines over time" /></Card>}
      <Card c="c12" title="Star history" sub="Sampled from GitHub’s star timestamps">{d.starHist ? <><Area label="Stars over time" data={d.starHist.pts.map(p => ({ label: monthYear(p.at), value: p.stars, tip: `${date(p.at)}: ${fmt(p.stars)} stars` }))} />{d.starHist.capped && <p className="note">GitHub only exposes the first 40,000 stars, so the curve jumps to today’s total at the end.</p>}</> : <div className="cta"><p>Draws the curve from up to 10 evenly spaced pages of stargazers.</p><Action label="Load star history (10 requests)" busy="Loading stars…" run={actions.stars} /></div>}</Card>
      {R.list.length > 0 && <Card c="c12" title="Recent releases"><div className="scroll"><table><thead><tr><th>Tag</th><th>Published</th><th>Type</th></tr></thead><tbody>{R.list.slice(0, 8).map(r => <tr key={r.tag}><td className="mono">{r.tag}</td><td>{date(r.at)}</td><td>{r.pre ? "Pre-release" : "Release"}</td></tr>)}</tbody></table></div></Card>}
    </div>
  </>;
}

export function People({ d, S }: PanelProps) {
  const P = S.people, rows = P ? P.list.slice(0, 15) : [], all = P ? P.list.reduce((t, x) => t + x.total, 0) : 0;
  return <>
    <dl className="tiles">
      <Tile k="Bus factor" v={S.bus != null ? fmt(S.bus) : null} sub={S.bus != null ? (S.bus === 1 ? "person wrote" : "people wrote") + " half of all commits" : ""} />
      <Tile k="Active in 90 days" v={P ? fmt(P.active90) : null} sub="of the top 100 authors" />
      <Tile k="Active in a year" v={P ? fmt(P.active365) : null} />
      <Tile k="Top author, recent" v={P?.topShare != null ? Math.round(P.topShare * 100) + "%" : null} sub="of commits in 90 days" />
      <Tile k="All contributors" v={d.contribs != null ? fmt(d.contribs) : null} sub="including anonymous" />
    </dl>
    <div className="grid gap">
      {rows.length > 0 ? <Card c="c12" title="Top authors" sub="By commits across all history"><div className="scroll"><table><thead><tr><th>Author</th><th>Commits</th><th>Share</th><th>Added</th><th>Deleted</th><th>Last 90 days</th><th>Last 6 months</th></tr></thead><tbody>{rows.map(p => <tr key={p.login}><td><div className="who"><img src={`${p.avatar}&s=48`} alt="" loading="lazy" width="24" height="24" /><a href={p.url} target="_blank" rel="noopener">{p.login}</a></div></td><Num>{fmt(p.total)}</Num><Num>{pct(p.total, all)}</Num><Num>+{compact(p.add)}</Num><Num>−{compact(p.del)}</Num><Num>{fmt(p.recent)}</Num><td><Sparkline values={p.spark} w={96} h={22} /></td></tr>)}</tbody></table></div></Card>
        : d.who.length > 0 ? <Card c="c12" title="Top contributors" note={d.syncing ? "Per-author history is on its way." : "GitHub hasn’t prepared per-author statistics yet. Refresh in a minute for the full table."}><div className="scroll"><table><tbody>{d.who.slice(0, 15).map(c => <tr key={c.login}><td><div className="who"><img src={`${c.avatar_url}&s=48`} alt="" loading="lazy" width="24" height="24" /><a href={c.html_url} target="_blank" rel="noopener">{c.login}</a></div></td><Num>{fmt(c.contributions)} commits</Num><td className="bar"><div style={{ width: `${c.contributions / d.who[0].contributions * 100}%` }} /></td></tr>)}</tbody></table></div></Card>
          : <Card c="c12"><Empty>No contributor data is available.</Empty></Card>}
      {P && P.newcomers.length > 1 && <Card c="c12" title="First-time authors by year" sub="Among the top 100 authors"><Columns h={170} label="New authors per year" data={P.newcomers.map(n => ({ label: n.label, value: n.value, tip: `${n.label}: ${n.value} new authors` }))} /></Card>}
    </div>
  </>;
}

export function Flow({ d, S }: PanelProps) {
  const F = S.flow, m = d.m;
  if (!F) return <div className="card"><Empty>Issue and pull request data isn’t available for this repository.</Empty></div>;
  const open = d.prs != null ? Math.max((m.open_issues_count || 0) - d.prs, 0) : m.open_issues_count, mx = Math.max(1, ...F.months.map(x => x.issues + x.prs)), ih = 168, L = 8, step = (640 - L) / Math.max(F.months.length, 1), bw = Math.min(step - 8, 40);
  return <>
    <dl className="tiles">
      <Tile k="Open issues" v={fmt(open)} />
      <Tile k="Open pull requests" v={d.prs != null ? fmt(d.prs) : null} />
      <Tile k="Median PR merge" v={F.prMedian != null ? fmtDur(F.prMedian) : null} sub={F.prP90 != null ? `slowest 10%: over ${fmtDur(F.prP90)}` : ""} />
      <Tile k="Median issue close" v={F.issueMedian != null ? fmtDur(F.issueMedian) : null} sub={F.issueP90 != null ? `slowest 10%: over ${fmtDur(F.issueP90)}` : ""} />
      <Tile k="Stale open items" v={F.openSample ? F.stale : null} sub={F.openSample ? `of ${F.openSample} checked, idle 90+ days` : ""} />
      <Tile k="PRs closed unmerged" v={fmt(F.unmerged)} sub={`alongside ${F.mergedSample} merged`} />
    </dl>
    <div className="grid gap">
      {F.months.length > 0 && <Card c="c7" title="Closed per month" sub="From the 100 most recently updated closed items"><svg className="chart" viewBox="0 0 640 200" role="img" aria-label="Issues and pull requests closed per month">{F.months.map((x, i) => { const cx = L + step * i + step / 2, a = x.prs / mx * ih, b = x.issues / mx * ih; return <g key={x.month}><rect x={cx - bw / 2} y={ih + 2 - a} width={bw} height={a} rx="3" fill="var(--s1)" /><rect x={cx - bw / 2} y={ih - a - b} width={bw} height={b} rx="3" fill="var(--s2)" /><rect className="hit" x={L + step * i} y="0" width={step} height={ih + 2} data-tip={`${monthYear(x.month + "-01")}\n${x.prs} pull requests\n${x.issues} issues`} /><text x={cx} y="192" textAnchor="middle">{monthYear(x.month + "-01")}</text></g>; })}</svg><ul className="legend"><li><em style={{ background: "var(--s1)" }} />Pull requests</li><li><em style={{ background: "var(--s2)" }} />Issues</li></ul></Card>}
      {F.openSample > 0 && <Card c="c5" title="Age of open items" sub={`The ${F.openSample} oldest-updated open items`}><HBars items={F.ages} ordinal label="Open items by age" /></Card>}
      {F.labels.length > 0 && <Card c="c12" title="Most used labels"><HBars items={F.labels} label="Labels by use" /></Card>}
    </div>
    <p className="note">GitHub’s issue list returns 100 items per request, so these figures are a recent sample rather than the full history.</p>
  </>;
}

export function Risk({ d, S, token, actions }: PanelProps) {
  const V = d.vulns, targets = scanTargets(d.deps), deep = d.deep, O = d.outdated, flags = [...S.flags.filter(f => f.kind === "secret"), ...S.flags.filter(f => f.kind === "code")];
  const canOutdated = d.deps.some(x => !x.exact && (x.ecosystem === "npm" || x.ecosystem === "PyPI")), by = (l: string) => V ? V.rows.filter(r => r.severity === l).length : 0;
  return <div className="grid">
    <Card c="c12" title="Known vulnerabilities" sub={`From OSV.dev, matched against ${d.deps.some(x => x.exact) ? "lock files and manifests" : "manifests"}`}>
      {!targets.length ? <Empty>No pinned dependency versions were found, so there’s nothing to scan.</Empty> : !V ? <div className="cta"><h3>Scan {fmt(targets.length)} {targets.length === 1 ? "package" : "packages"} for known vulnerabilities</h3><p>Sends package names and versions to OSV.dev, a free public database run by Google.{d.local || d.m.private ? " This is the one step that leaves your device." : ""}</p><Action pri label="Run scan" busy="Reading advisories…" run={actions.scan} /></div> : <>
        <dl className="tiles flat"><Tile k="Advisories" v={fmt(V.total)} sub={`in ${fmt(V.affected)} packages`} /><Tile k="Critical and high" v={fmt(by("CRITICAL") + by("HIGH"))} /><Tile k="Moderate" v={fmt(by("MODERATE"))} /><Tile k="Packages checked" v={fmt(V.checked)} sub={V.approx ? `${fmt(V.approx)} from version ranges` : "exact versions"} /></dl>
        {V.rows.length ? <div className="scroll"><table><thead><tr><th>Advisory</th><th>Severity</th><th>Package</th><th>Version</th><th>Fixed in</th></tr></thead><tbody>{V.rows.slice(0, 40).map(r => <tr key={r.id + r.pkg.name}><td className="wrap"><a href={`https://osv.dev/vulnerability/${r.id}`} target="_blank" rel="noopener" className="mono">{r.alias || r.id}</a><br /><span className="mute">{r.summary}</span></td><td><SevPill s={r.severity} /></td><td className="mono" style={{ textAlign: "right" }}>{r.pkg.name}</td><Num>{r.pkg.version}</Num><Num>{r.fixed || "–"}</Num></tr>)}</tbody></table></div> : <Empty>No known advisories match these versions.</Empty>}
        {d.deps.some(x => x.exact) && <p className="note">Lock files include development tools as well as what ships to users, so check whether each package reaches production.</p>}
        {V.approx > 0 && <p className="note">Versions taken from a range like ^1.2.3 use the lowest allowed version, so the real install may already be patched. A lock file gives exact results.</p>}
      </>}
    </Card>
    {canOutdated && (!O ? <Card c="c12"><div className="cta"><h3>Check for outdated dependencies</h3><p>Compares your manifests with the npm and PyPI registries. Package names leave your device, and no GitHub quota is used.</p><Action label="Check for updates" busy="Checking registries…" run={actions.outdated} /></div></Card>
      : <Card c="c12" title="Dependency freshness" sub={`${fmt(O.rows.length)} of ${fmt(O.checked)} checked packages are at least one major version behind`}>{O.rows.length ? <div className="scroll"><table><thead><tr><th>Package</th><th>Yours</th><th>Latest</th><th>Majors behind</th></tr></thead><tbody>{O.rows.slice(0, 25).map(r => <tr key={r.name}><td className="mono">{r.name}</td><Num>{r.version}</Num><Num>{r.latest}</Num><Num>{r.gap}</Num></tr>)}</tbody></table></div> : <Empty>Everything checked is on the latest major version.</Empty>}</Card>)}
    <Card c="c12" title="Source scan" sub="Searches every file for secrets and risky calls. Examples, docs and tests are skipped." note={flags.length ? `Pattern matching can flag false positives, so confirm each one.${flags.length > 30 ? ` Showing 30 of ${flags.length}.` : ""} Rotate any real secret, because deleting it doesn’t remove it from git history.` : undefined}>{flags.length ? <div className="scroll"><table><thead><tr><th>Location</th><th>Finding</th><th>Severity</th><th>Masked value</th></tr></thead><tbody>{flags.slice(0, 30).map((f, i) => <tr key={i}><Path p={f.path} label={`${f.path}:${f.line}`} /><td style={{ textAlign: "right" }}>{f.name}</td><td><SevPill s={f.severity} /></td><Num>{f.preview || "–"}</Num></tr>)}</tbody></table></div> : <Empty>No secrets or risky calls were found.</Empty>}</Card>
    {S.debtTotal > 0 && <Card c="c12" title="Tech debt notes" sub={`${fmt(S.debtTotal)} markers left in the code: ${S.debtTags.map(t => `${t.value} ${t.label}`).join(", ")}`}><div className="scroll"><table><thead><tr><th>Location</th><th>Tag</th><th>Note</th></tr></thead><tbody>{S.debt.slice(0, 15).map((x, i) => <tr key={i}><Path p={x.path} label={`${x.path}:${x.line}`} /><td style={{ textAlign: "right" }}>{x.tag}</td><td className="wrap">{x.text || "–"}</td></tr>)}</tbody></table></div></Card>}
    {!d.local && (deep ? <>
      {deep.hot.length > 0 && <Card c="c12" title="Churn hotspots" sub={`Code that changes often and has many branch points, from the last ${deep.sample} commits`} note="The shaded corner marks files that change often and are hard to change. Start refactoring and testing there."><Quadrant hot={deep.hot.filter(h => h.br).slice(0, 60)} /></Card>}
      {deep.hot.length > 0 && <Card c="c12" title="Riskiest files"><div className="scroll"><table><thead><tr><th>File</th><th>Risk</th><th>Commits</th><th>Authors</th><th>Added</th><th>Deleted</th><th>Branches</th></tr></thead><tbody>{deep.hot.slice(0, 12).map(h => <tr key={h.path}><Path p={h.path} /><Num>{h.risk}</Num><Num>{h.commits}</Num><Num>{h.authors}</Num><Num>+{fmt(h.add)}</Num><Num>−{fmt(h.del)}</Num><Num>{fmt(h.br)}</Num></tr>)}</tbody></table></div></Card>}
      <Card c="c7" title="Change coupling" sub="Files that keep changing together, which often signals a hidden dependency" note="Commits touching more than 20 files are ignored.">{deep.coupling.length ? <div className="scroll"><table><thead><tr><th>Pair</th><th>Together</th><th>Rate</th></tr></thead><tbody>{deep.coupling.map(c => <tr key={c.a + c.b}><td className="path">{c.a}<br />{c.b}</td><Num>{c.n}</Num><Num>{Math.round(c.ratio * 100)}%</Num></tr>)}</tbody></table></div> : <Empty>No pair of files changed together twice in this sample.</Empty>}</Card>
      <Card c="c5" title="Ownership" sub="Who touches each top-level folder most"><div className="scroll"><table><thead><tr><th>Folder</th><th>Lead</th><th>Share</th><th>Authors</th></tr></thead><tbody>{deep.ownership.map(o => <tr key={o.dir}><td className="mono">{o.dir}</td><td style={{ textAlign: "right" }}>{o.owner}</td><Num>{Math.round(o.share * 100)}%</Num><Num>{o.authors}</Num></tr>)}</tbody></table></div></Card>
    </> : <Card c="c12"><div className="cta"><h3>Find churn hotspots, coupling and ownership</h3><p>Reads the file list of recent commits. Uses <b>{deepLimit(token) + 1}</b> GitHub requests from your quota.</p><Action pri label="Run deep scan" busy="Reading commits…" run={actions.deep} /></div></Card>)}
    {d.deps.length > 0 && <Card c="c12" title="Dependency manifests"><div className="scroll"><table><thead><tr><th>File</th><th>Type</th><th>Packages</th><th>Sample</th></tr></thead><tbody>{d.deps.slice(0, 10).map(x => <tr key={x.file}><td className="path">{x.file}</td><td style={{ textAlign: "right" }}>{x.kind}</td><Num>{fmt(x.names.length)}</Num><td className="wrap" style={{ textAlign: "right" }}>{x.names.slice(0, 5).join(", ")}{x.names.length > 5 ? "…" : ""}</td></tr>)}</tbody></table></div></Card>}
  </div>;
}
