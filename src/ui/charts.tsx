// SVG charts as React components. Tooltips come from data-tip, and data-file opens the file inspector.
import { useMemo, type ReactNode } from "react";
import type { CodeFreq, FileStat, Graph, HotFile, LabelValue, Punch, WeekActivity } from "../core/types";
import { compact, date, fmt, monthYear } from "../lib/util";

const r1 = (n: number) => +n.toFixed(1);
export const SERIES = 8;
export const slot = (i: number) => i < SERIES ? `var(--s${i + 1})` : "var(--rest)";

function niceMax(v: number) {
  if (v <= 4) return Math.max(v, 1);
  const p = 10 ** Math.floor(Math.log10(v)), n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
const Frame = ({ w, h, label, children }: { w: number; h: number; label: string; children: ReactNode }) => <svg className="chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}>{children}</svg>;
const YAxis = ({ max, x0, x1, y, h }: { max: number; x0: number; x1: number; y: number; h: number }) => <>{[0, .5, 1].map(t => <g key={t}><line className="grid-l" x1={x0} x2={x1} y1={r1(y + h * (1 - t))} y2={r1(y + h * (1 - t))} /><text x={x0 - 6} y={r1(y + h * (1 - t) + 4)} textAnchor="end">{compact(max * t)}</text></g>)}</>;
function XLabels({ labels, x, y, n = 5 }: { labels: string[]; x: (i: number) => number; y: number; n?: number }) {
  const step = Math.max(1, Math.round((labels.length - 1) / (n - 1)));
  return <>{labels.map((l, i) => (i % step === 0 && labels.length - 1 - i >= step * .6) || i === labels.length - 1 ? <text key={i} x={r1(x(i))} y={y} textAnchor={i === labels.length - 1 ? "end" : i ? "middle" : "start"}>{l}</text> : null)}</>;
}

export interface Column { label: string; value: number; tip: string }
export function Columns({ data, w = 760, h = 200, color = "var(--acc)", label }: { data: Column[]; w?: number; h?: number; color?: string; label: string }) {
  const L = 38, B = 22, T = 6, ih = h - B - T, iw = w - L, max = niceMax(Math.max(1, ...data.map(d => d.value))), step = iw / data.length, bw = Math.max(1, Math.min(step - 2, 22)), x = (i: number) => L + step * i + step / 2;
  return <Frame w={w} h={h} label={label}><YAxis max={max} x0={L} x1={w} y={T} h={ih} />{data.map((d, i) => {
    const bh = d.value ? Math.max(2, d.value / max * ih) : 0, rx = Math.min(4, bw / 2), bx = r1(x(i) - bw / 2);
    return <g key={i}>{bh > 0 && <path d={`M${bx} ${T + ih}v${r1(-bh + rx)}q0 ${-rx} ${rx} ${-rx}h${r1(bw - 2 * rx)}q${rx} 0 ${rx} ${rx}v${r1(bh - rx)}z`} fill={color} />}<rect className="hit" x={r1(L + step * i)} y={T} width={r1(step)} height={ih} data-tip={d.tip} /></g>;
  })}<XLabels labels={data.map(d => d.label)} x={x} y={h - 6} /></Frame>;
}

export function Diverging({ data, w = 760, h = 220, label }: { data: CodeFreq[]; w?: number; h?: number; label: string }) {
  const L = 44, B = 22, T = 6, ih = h - B - T, iw = w - L, max = niceMax(Math.max(1, ...data.flatMap(d => [d[1], -d[2]]))), zero = T + ih / 2, sc = (ih / 2) / max, step = iw / data.length, bw = Math.max(1, step - 1), x = (i: number) => L + step * i + step / 2;
  return <Frame w={w} h={h} label={label}>
    <line className="grid-l" x1={L} x2={w} y1={T} y2={T} /><line className="grid-l" x1={L} x2={w} y1={T + ih} y2={T + ih} />
    <text x={L - 6} y={T + 4} textAnchor="end">+{compact(max)}</text><text x={L - 6} y={zero + 4} textAnchor="end">0</text><text x={L - 6} y={T + ih + 4} textAnchor="end">−{compact(max)}</text>
    {data.map((d, i) => <g key={i}><rect x={r1(x(i) - bw / 2)} y={r1(zero - d[1] * sc)} width={r1(bw)} height={r1(d[1] * sc)} fill="var(--s1)" /><rect x={r1(x(i) - bw / 2)} y={zero} width={r1(bw)} height={r1(-d[2] * sc)} fill="var(--s2)" /><rect className="hit" x={r1(L + step * i)} y={T} width={r1(step)} height={ih} data-tip={`Week of ${date(d[0] * 1000)}\n+${fmt(d[1])} added\n−${fmt(-d[2])} deleted`} /></g>)}
    <line x1={L} x2={w} y1={zero} y2={zero} stroke="var(--ink3)" /><XLabels labels={data.map(d => monthYear(d[0] * 1000))} x={x} y={h - 6} />
  </Frame>;
}

export function Area({ data, w = 760, h = 200, label, color = "var(--acc)" }: { data: Column[]; w?: number; h?: number; label: string; color?: string }) {
  const L = 44, B = 22, T = 8, ih = h - B - T, iw = w - L - 4, max = niceMax(Math.max(1, ...data.map(d => d.value))), n = data.length, X = (i: number) => L + (n > 1 ? iw * i / (n - 1) : 0), Y = (v: number) => T + ih - Math.max(v, 0) / max * ih;
  const pts = data.map((d, i) => `${r1(X(i))},${r1(Y(d.value))}`).join(" "), cw = iw / Math.max(n - 1, 1);
  return <Frame w={w} h={h} label={label}><YAxis max={max} x0={L} x1={w} y={T} h={ih} /><polygon points={`${L},${T + ih} ${pts} ${r1(X(n - 1))},${T + ih}`} fill={color} opacity=".14" /><polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />{data.map((d, i) => <rect key={i} className="hit" x={r1(X(i) - cw / 2)} y={T} width={r1(cw)} height={ih} data-tip={d.tip} />)}<XLabels labels={data.map(d => d.label)} x={X} y={h - 6} /></Frame>;
}

export function Lines({ series, labels, w = 760, h = 240, label }: { series: { name: string; color: string; values: number[] }[]; labels: string[]; w?: number; h?: number; label: string }) {
  const L = 38, B = 22, T = 8, R = 8, ih = h - B - T, iw = w - L - R, n = labels.length, max = niceMax(Math.max(1, ...series.flatMap(s => s.values))), X = (i: number) => L + (n > 1 ? iw * i / (n - 1) : 0), Y = (v: number) => T + ih - v / max * ih;
  return <Frame w={w} h={h} label={label}><YAxis max={max} x0={L} x1={w - R} y={T} h={ih} />{series.map(s => <polyline key={s.name} points={s.values.map((v, i) => `${r1(X(i))},${r1(Y(v))}`).join(" ")} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" />)}{labels.map((l, i) => <rect key={i} className="hit" x={r1(X(i) - iw / n / 2)} y={T} width={r1(iw / n)} height={ih} data-tip={l + "\n" + series.map(s => `${s.name}: ${s.values[i]}`).join("\n")} />)}<XLabels labels={labels} x={X} y={h - 6} /></Frame>;
}

const lvlOf = (n: number, max: number) => !n ? 0 : Math.min(4, 1 + Math.floor(n / max * 3.999));
export function Heatmap({ act }: { act: WeekActivity[] }) {
  const c = 13, L = 28, T = 16, max = Math.max(...act.flatMap(w => w.days || []), 1); let last = -1;
  return <Frame w={L + act.length * c} h={T + 7 * c} label="Commits per day over the last year">
    {act.map((w, i) => { const m = new Date(w.week * 1000).getUTCMonth(); if (m === last) return null; last = m; return i > act.length - 3 ? null : <text key={i} x={L + i * c} y={10}>{new Date(w.week * 1000).toLocaleDateString("en-GB", { month: "short" })}</text>; })}
    {([[1, "Mon"], [3, "Wed"], [5, "Fri"]] as const).map(([d, n]) => <text key={n} x={0} y={T + d * c + 9}>{n}</text>)}
    {act.map((w, wi) => (w.days || []).map((n, di) => <rect key={`${wi}-${di}`} className="cell" x={L + wi * c} y={T + di * c} width={c - 3} height={c - 3} rx={2} fill={n === max ? "var(--pop)" : `var(--h${lvlOf(n, max)})`} data-tip={`${date((w.week + di * 86400) * 1000)}: ${n} ${n === 1 ? "commit" : "commits"}`} />))}
  </Frame>;
}
export const HeatScale = () => <ul className="legend"><li><small>Fewer commits</small></li>{[0, 1, 2, 3, 4].map(i => <li key={i}><em style={{ background: `var(--h${i})` }} /></li>)}<li><small>More</small></li><li><em style={{ background: "var(--pop)" }} /><small>Busiest day</small></li></ul>;

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function PunchCard({ pc }: { pc: Punch[] }) {
  const c = 30, ch = 24, L = 36, T = 18, max = Math.max(...pc.map(x => x[2]), 1), hh = (h: number) => String(h).padStart(2, "0");
  return <Frame w={L + 24 * c} h={T + 7 * ch} label="Commits by weekday and hour, in UTC">
    {[0, 6, 12, 18].map(h => <text key={h} x={L + h * c} y={11}>{hh(h)}:00</text>)}{WD.map((n, i) => <text key={n} x={0} y={T + i * ch + 15}>{n}</text>)}
    {pc.map(([d, h, n]) => <rect key={`${d}-${h}`} className="cell" x={L + h * c} y={T + d * ch} width={c - 3} height={ch - 3} rx={3} fill={`var(--h${lvlOf(n, max)})`} data-tip={`${WD[d]} ${hh(h)}:00 UTC: ${n} ${n === 1 ? "commit" : "commits"}`} />)}
  </Frame>;
}

export function Sparkline({ values, w = 64, h = 24 }: { values: number[]; w?: number; h?: number }) {
  const max = Math.max(1, ...values), n = values.length, pts = values.map((v, i) => `${r1(i / Math.max(n - 1, 1) * (w - 2) + 1)},${r1(h - 2 - v / max * (h - 4))}`).join(" ");
  return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ display: "inline-block", verticalAlign: "middle", flex: "none" }}><polyline points={pts} fill="none" stroke="var(--acc)" strokeWidth="1.5" strokeLinejoin="round" /></svg>;
}

export function Quadrant({ hot, w = 760, h = 300 }: { hot: HotFile[]; w?: number; h?: number }) {
  const L = 40, B = 34, T = 8, R = 10, iw = w - L - R, ih = h - B - T, mx = Math.max(1, ...hot.map(p => p.commits)), my = Math.max(1, ...hot.map(p => p.br)), X = (v: number) => L + v / mx * iw, Y = (v: number) => T + ih - v / my * ih, top = new Set(hot.slice(0, 4).map(p => p.path));
  return <Frame w={w} h={h} label="Files by change frequency and branch points">
    <rect x={L + iw / 2} y={T} width={iw / 2} height={ih / 2} fill="var(--risk-bg)" /><line className="grid-l" x1={L} x2={w - R} y1={T + ih} y2={T + ih} /><line className="grid-l" x1={L} x2={L} y1={T} y2={T + ih} />
    <text x={w - R} y={h - 6} textAnchor="end">Changed more often →</text><text x={L} y={h - 6}>0</text><text x={L - 6} y={T + 10} textAnchor="end">{compact(my)}</text><text x={L + 6} y={T + 12}>↑ More branch points</text>
    {[...hot].reverse().map(p => { const lb = top.has(p.path) && p.risk > 0, cx = X(p.commits), left = cx > w * .68; return <g key={p.path}><circle cx={r1(cx)} cy={r1(Y(p.br))} r={lb ? 6 : 4.5} fill={lb ? "var(--acc)" : "var(--rest)"} stroke="var(--surface)" strokeWidth="2" data-file={p.path} data-tip={`${p.path}\n${p.commits} commits, ${p.br} branch points, ${p.authors} ${p.authors === 1 ? "author" : "authors"}`} />{lb && <text className="lb" x={r1(cx + (left ? -10 : 10))} y={r1(Y(p.br) + 4)} textAnchor={left ? "end" : "start"}>{p.path.split("/").pop()!.slice(0, 30)}</text>}</g>; })}
  </Frame>;
}

export function Radar({ dims, color }: { dims: { label: string; score: number | null }[]; color: string }) {
  const live = dims.filter(d => d.score != null) as { label: string; score: number }[], s = 300, c = s / 2, R = 92, n = live.length || 1;
  const P = (i: number, v: number): [number, number] => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return [c + Math.cos(a) * R * v, c + Math.sin(a) * R * v]; };
  const ring = (v: number) => live.map((_, i) => P(i, v).map(r1).join(",")).join(" ");
  return <Frame w={s} h={s} label={"Health by dimension: " + live.map(d => `${d.label} ${d.score}`).join(", ")}>
    {[.5, 1].map(v => <polygon key={v} points={ring(v)} fill="none" stroke="var(--line)" />)}
    {live.map((d, i) => { const [x, y] = P(i, 1), [tx, ty] = P(i, 1.14); return <g key={d.label}><line x1={c} y1={c} x2={r1(x)} y2={r1(y)} stroke="var(--line)" /><text x={r1(tx)} y={r1(ty + 4)} textAnchor={tx < c - 8 ? "end" : tx > c + 8 ? "start" : "middle"}>{d.label.split(" ")[0]}</text></g>; })}
    <polygon points={live.map((d, i) => P(i, d.score / 100).map(r1).join(",")).join(" ")} fill={color} fillOpacity=".2" stroke={color} strokeWidth="2" />
    {live.map((d, i) => { const [x, y] = P(i, d.score / 100); return <circle key={d.label} cx={r1(x)} cy={r1(y)} r="4" fill={color} stroke="var(--surface)" strokeWidth="2" data-tip={`${d.label}: ${d.score}`} />; })}
  </Frame>;
}

export function Ring({ score, grade }: { score: number; grade: string }) {
  const R = 84, C = 2 * Math.PI * R;
  return <div className="ring" role="img" aria-label={`Health score ${score} of 100, grade ${grade}`}><svg viewBox="0 0 196 196"><circle className="tr" cx="98" cy="98" r={R} /><circle className="fg" cx="98" cy="98" r={R} strokeDasharray={C.toFixed(1)} strokeDashoffset={(C * (1 - score / 100)).toFixed(1)} /></svg><div><strong>{score}</strong><span>Grade {grade}</span></div></div>;
}

// one cell per file, spiraling out from the most branch-heavy file
export function Hive({ files }: { files: FileStat[] }) {
  const { pts, ext } = useMemo(() => {
    const list = files.filter(f => f.lines).sort((a, b) => (b.br || 0) - (a.br || 0)).slice(0, 169), S = 11, W = Math.sqrt(3) * S, cells: [number, number][] = [[0, 0]];
    for (let ring = 1; cells.length < list.length; ring++) {
      let q = -ring, r = ring;
      for (const [dq, dr] of [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]) for (let i = 0; i < ring; i++) { cells.push([q, r]); q += dq; r += dr; }
    }
    const dens = list.map(f => f.br || 0).sort((a, b) => b - a), cut = (p: number) => dens[Math.floor((dens.length - 1) * p)] || 0, lvl = (v: number) => !v ? 1 : v >= cut(.1) ? 5 : v >= cut(.3) ? 4 : v >= cut(.6) ? 3 : 2;
    const hex = (x: number, y: number) => Array.from({ length: 6 }, (_, i) => { const t = Math.PI / 180 * (60 * i - 30), k = S - 1.2; return `${r1(x + k * Math.cos(t))},${r1(y + k * Math.sin(t))}`; }).join(" ");
    const pts = list.map((f, i) => { const [q, r] = cells[i], x = W * (q + r / 2), y = 1.5 * S * r; return { f, x, y, lvl: lvl(f.br || 0), hex: hex(x, y) }; });
    return { pts, ext: Math.max(...pts.flatMap(p => [Math.abs(p.x), Math.abs(p.y)]), 20) + S + 2 };
  }, [files]);
  return <svg className="hive" viewBox={`${r1(-ext)} ${r1(-ext)} ${r1(ext * 2)} ${r1(ext * 2)}`} role="img" aria-label={`Honeycomb of ${pts.length} files, warmest for the most branch points`}>{pts.map(p => <polygon key={p.f.path} points={p.hex} fill={`var(--hx${p.lvl})`} data-file={p.f.path} data-tip={`${p.f.path}\n${fmt(p.f.br || 0)} branch points, ${fmt(p.f.lines)} lines`} />)}</svg>;
}

export function HBars({ items, color = "var(--acc)", ordinal, label }: { items: LabelValue[]; color?: string; ordinal?: boolean; label: string }) {
  const max = Math.max(1, ...items.map(d => d.value));
  return <div className="bars-h" role="img" aria-label={label + ": " + items.map(d => `${d.label} ${d.value}`).join(", ")}>{items.map((d, i) => <div className="bh" key={d.label}><span title={d.label}>{d.label}</span><u><i style={{ width: `${d.value / max * 100}%`, background: ordinal ? `var(--h${Math.min(4, i + 1)})` : color }} /></u><b>{fmt(d.value)}</b></div>)}</div>;
}

export function ArchMap({ g, pos, colorOf, W = 1000, H = 560 }: { g: Graph; pos: [number, number][]; colorOf: (k: string) => string; W?: number; H?: number }) {
  const r = (n: Graph["nodes"][number]) => r1(Math.min(15, 4 + Math.sqrt(n.in + 1) * 1.8 + Math.sqrt(n.lines) * .06));
  const trace = (i: number | null, svg: SVGSVGElement) => {
    svg.querySelectorAll(".lit").forEach(x => x.classList.remove("lit"));
    svg.classList.toggle("tracing", i != null);
    if (i == null) return;
    svg.querySelector(`.node[data-i="${i}"]`)?.classList.add("lit");
    svg.querySelectorAll<SVGLineElement>(`line[data-a="${i}"],line[data-b="${i}"]`).forEach(l => { l.classList.add("lit"); svg.querySelector(`.node[data-i="${l.dataset.a === String(i) ? l.dataset.b : l.dataset.a}"]`)?.classList.add("lit"); });
  };
  return <svg className="arch" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Import map of ${g.nodes.length} files`} onPointerOver={e => { const n = (e.target as Element).closest<SVGGElement>(".node"); trace(n ? +n.dataset.i! : null, e.currentTarget); }} onPointerLeave={e => trace(null, e.currentTarget)}>
    {g.edges.map((e, i) => <line key={i} className={e.cycle ? "cy" : undefined} data-a={e.a} data-b={e.b} x1={pos[e.a][0]} y1={pos[e.a][1]} x2={pos[e.b][0]} y2={pos[e.b][1]} />)}
    {g.nodes.map((n, i) => <g key={n.path} className="node" data-i={i} data-file={n.path} data-tip={`${n.path}\nImported by ${n.in}, imports ${n.out}, ${fmt(n.lines)} lines${n.cycle ? "\nPart of a circular dependency" : ""}`}><circle cx={pos[i][0]} cy={pos[i][1]} r={r(n)} fill={colorOf(n.group)} />{n.in >= 3 && <text x={pos[i][0]} y={pos[i][1] + r(n) + 11} textAnchor="middle">{n.path.split("/").pop()!.slice(0, 22)}</text>}</g>)}
  </svg>;
}
