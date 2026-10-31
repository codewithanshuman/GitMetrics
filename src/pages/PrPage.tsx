import { useEffect, useState } from "react";
import { useApp } from "../app/App";
import { errorText, isLimit } from "../app/analysis";
import { pullRequest } from "../core/github";
import { fmtDur, prStats } from "../core/metrics";
import { compact, fmt } from "../lib/util";
import { HBars } from "../ui/charts";
import { Card, Empty, FindingRow, Num, Tile } from "../ui/parts";
import { Failure, Loading, useSteps } from "./Loading";

type Data = Awaited<ReturnType<typeof pullRequest>>;
export function PrPage({ o, n, num }: { o: string; n: string; num: string }) {
  const { token, go, home } = useApp(), { steps, step } = useSteps(), [data, setData] = useState<Data | null>(null), [err, setErr] = useState<{ msg: string; limited: boolean } | null>(null);
  useEffect(() => {
    const ctl = new AbortController(); setData(null); setErr(null); step("p", "run"); document.title = `${o}/${n}#${num} · GitMetrics`;
    pullRequest({ o, n, num, token, signal: ctl.signal }).then(setData).catch(e => { if (e.name !== "AbortError") setErr({ msg: errorText(e, "reading the pull request"), limited: isLimit(e) }); });
    return () => ctl.abort();
  }, [o, n, num]);
  if (err) return <Failure msg={err.msg} limited={err.limited} />;
  if (!data) return <Loading title={`${o}/${n} #${num}`} steps={[["p", "Reading the pull request"]]} state={steps} onCancel={home} />;
  const { pr, files, reviews } = data, P = prStats(pr, files, reviews), state = pr.merged_at ? ["on", "Merged"] : pr.state === "open" ? ["sync", pr.draft ? "Draft" : "Open"] : ["off", "Closed"];
  return <div className="page">
    <header className="head"><img src={`${pr.user.avatar_url}&s=104`} alt="" width="52" height="52" /><div><h1><a href={pr.html_url} target="_blank" rel="noopener">{pr.title}</a></h1><div className="meta"><span className={"st " + state[0]}><i />{state[1]}</span><span className="mono">{o}/{n}#{pr.number}</span><span>by {pr.user.login}</span><span className="mono">{pr.head.ref} → {pr.base.ref}</span></div></div><div className="headact"><button className="btn" onClick={() => go(`${o}/${n}`)}>Open repository report</button></div></header>
    <dl className="tiles">
      <Tile k="Review risk" v={P.score} sub={<span className={"pill " + (P.level === "High" ? "HIGH" : P.level === "Medium" ? "MODERATE" : "LOW")}>{P.level}</span>} />
      <Tile k="Size" v={P.size} sub={`${fmt(P.changed)} lines changed`} />
      <Tile k="Added" v={"+" + compact(pr.additions)} sub={`−${compact(pr.deletions)} deleted`} />
      <Tile k="Files" v={fmt(pr.changed_files)} sub={files.length < pr.changed_files ? `first ${files.length} analyzed` : ""} />
      <Tile k={pr.state === "open" ? "Open for" : "Was open for"} v={fmtDur(P.age)} />
      <Tile k="Approvals" v={fmt(P.approved)} sub={`${fmt(pr.comments + pr.review_comments)} comments`} />
    </dl>
    <div className="grid gap">
      <Card c="c6" title="Review notes"><div className="flist">{P.notes.map(f => <FindingRow key={f.title} f={f} />)}{!P.notes.length && <Empty>Nothing stood out.</Empty>}</div></Card>
      {P.langs.length > 0 && <Card c="c6" title="Changed lines by language"><HBars items={P.langs} label="Changed lines by language" /></Card>}
      <Card c="c12" title="Files changed" note="Risk is a rule-based estimate from size, tests, sensitive paths and review state."><div className="scroll"><table><thead><tr><th>File</th><th>Status</th><th>Added</th><th>Deleted</th></tr></thead><tbody>{[...files].sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions)).slice(0, 40).map(f => <tr key={f.filename}><td className="path">{f.filename}</td><td>{f.status}</td><Num>+{fmt(f.additions)}</Num><Num>−{fmt(f.deletions)}</Num></tr>)}</tbody></table></div></Card>
    </div>
  </div>;
}
