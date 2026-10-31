import { useEffect, useState } from "react";
import { useApp } from "../app/App";
import { errorText, isLimit, loadRepo, parseRepo } from "../app/analysis";
import { summarize } from "../core/metrics";
import type { Report, Summary } from "../core/types";
import { date, fmt, monthYear } from "../lib/util";
import { Lines, Radar, slot } from "../ui/charts";
import { Card } from "../ui/parts";
import { Failure, Loading, useSteps } from "./Loading";

interface Row { d: Report; S: Summary; color: string }
const METRICS: [string, (x: Row) => number | null | undefined][] = [["Health score", x => x.S.health?.score], ["Total lines", x => x.S.total], ["Code lines", x => x.S.T.code], ["Files", x => x.S.T.files], ["Comments per 100 code lines", x => x.S.T.code ? +(x.S.T.com / x.S.T.code * 100).toFixed(1) : 0], ["Test share (%)", x => x.S.testShare != null ? +(x.S.testShare * 100).toFixed(1) : null], ["Stars", x => x.d.m.stargazers_count], ["Forks", x => x.d.m.forks_count], ["Commits", x => x.d.commits], ["Commits, last year", x => x.S.yearCommits], ["Contributors", x => x.d.contribs], ["Bus factor", x => x.S.bus], ["Circular dependencies", x => x.S.arch.cycleCount], ["Releases", x => x.d.releases]];

export function ComparePage({ list }: { list: string[] }) {
  const { token, vendor, go, home } = useApp(), { steps, step } = useSteps(), [rows, setRows] = useState<Row[] | null>(null), [err, setErr] = useState<{ msg: string; limited: boolean } | null>(null);
  const names = list.join(), labels = list.map((x, i): [string, string] => ["r" + i, x]);
  useEffect(() => {
    const ctl = new AbortController(); setRows(null); setErr(null); document.title = "Compare · GitMetrics";
    (async () => {
      const out: Row[] = [];
      for (let i = 0; i < list.length; i++) {
        const spec = parseRepo(list[i]); if (!spec) throw new Error(`“${list[i]}” isn’t a repository.`);
        step("r" + i, "run");
        const d = await loadRepo(spec, token, vendor, (_, __, note) => step("r" + i, "run", note), ctl.signal);
        out.push({ d, S: summarize(d), color: slot(i) }); step("r" + i, "done");
      }
      setRows(out);
    })().catch(e => { if (e.name !== "AbortError") setErr({ msg: errorText(e, "collecting data"), limited: isLimit(e) }); });
    return () => ctl.abort();
  }, [names]);
  if (err) return <Failure msg={err.msg} limited={err.limited} />;
  if (!rows) return <Loading title="Comparing repositories" steps={labels} state={steps} onCancel={home} />;
  const best = METRICS.map(([, f]) => Math.max(...rows.map(x => f(x) ?? -1))), acts = rows.filter(x => x.d.act), wk = acts[0]?.d.act;
  const smooth = (a: { total: number }[]) => a.map((_, i) => { const s = a.slice(Math.max(0, i - 3), i + 1); return Math.round(s.reduce((t, w) => t + w.total, 0) / s.length); });
  return <div className="page">
    <header className="head"><div><h1>Comparing {rows.length} repositories</h1><p>The highest value in each row is highlighted.</p></div><div className="headact"><button className="btn" onClick={() => print()}>Save as PDF</button></div></header>
    <div className="grid">
      <Card c="c12" title="Health by dimension" sub="Outer ring is 100. Dimensions without data are left out."><div className="radars">{rows.map(x => <figure key={x.d.m.full_name}>{x.S.health && <Radar dims={x.S.health.dims} color={x.color} />}<figcaption>{x.d.m.full_name}{x.S.health ? ` · ${x.S.health.score} (${x.S.health.grade})` : ""}</figcaption></figure>)}</div></Card>
      {wk && <Card c="c12" title="Commits per week" sub="Four-week average over the last year"><Lines label="Commits per week by repository" series={acts.map(x => ({ name: x.d.m.full_name, color: x.color, values: smooth(x.d.act!) }))} labels={wk.map(w => monthYear(w.week * 1000))} /><ul className="legend">{acts.map(x => <li key={x.d.m.full_name}><em style={{ background: x.color }} />{x.d.m.full_name}</li>)}</ul></Card>}
      <Card c="c12"><div className="scroll"><table><thead><tr><th />{rows.map(x => <th key={x.d.m.full_name}><button className="chip" onClick={() => go(x.d.m.full_name)}>{x.d.m.full_name}</button></th>)}</tr></thead><tbody>
        {METRICS.map(([k, f], i) => <tr key={k}><td>{k}</td>{rows.map(x => { const v = f(x); return <td className="num" key={x.d.m.full_name}>{v == null ? "–" : v === best[i] && rows.length > 1 ? <span className="best">{fmt(v)}</span> : fmt(v)}</td>; })}</tr>)}
        <tr><td>Main language</td>{rows.map(x => <td key={x.d.m.full_name}>{x.S.rows[0]?.name || "–"}</td>)}</tr>
        <tr><td>License</td>{rows.map(x => <td key={x.d.m.full_name}>{x.d.m.license?.spdx_id || "None"}</td>)}</tr>
        <tr><td>Last push</td>{rows.map(x => <td key={x.d.m.full_name}>{x.d.m.pushed_at ? date(x.d.m.pushed_at) : "–"}</td>)}</tr>
      </tbody></table></div></Card>
    </div>
  </div>;
}
