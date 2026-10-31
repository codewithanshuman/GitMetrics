import { useEffect, useState } from "react";
import { useApp } from "../app/App";
import { errorText, isLimit } from "../app/analysis";
import { profileData } from "../core/github";
import type { ProfileData } from "../core/types";
import { compact, date, fmt, pct } from "../lib/util";
import { Columns, SERIES, slot } from "../ui/charts";
import { Card, Num, Tile } from "../ui/parts";
import { Failure, Loading, useSteps } from "./Loading";

export function ProfilePage({ user }: { user: string }) {
  const { token, go, home } = useApp(), { steps, step } = useSteps(), [data, setData] = useState<ProfileData | null>(null), [err, setErr] = useState<{ msg: string; limited: boolean } | null>(null);
  useEffect(() => {
    const ctl = new AbortController(); setData(null); setErr(null); step("p", "run"); document.title = `@${user} · GitMetrics`;
    profileData({ user, token, signal: ctl.signal }).then(setData).catch(e => { if (e.name !== "AbortError") setErr({ msg: errorText(e, "loading the profile"), limited: isLimit(e) }); });
    return () => ctl.abort();
  }, [user]);
  if (err) return <Failure msg={err.msg} limited={err.limited} />;
  if (!data) return <Loading title={"@" + user} steps={[["p", "Loading profile and repositories"]]} state={steps} onCancel={home} />;
  const { info, repos } = data, own = repos.filter(r => !r.fork), sum = (k: "stargazers_count" | "forks_count") => own.reduce((t, r) => t + (r[k] || 0), 0);
  const lc: Record<string, number> = {}; own.forEach(r => { if (r.language) lc[r.language] = (lc[r.language] || 0) + 1; });
  const lg = Object.entries(lc).sort((a, b) => b[1] - a[1]), head = lg.slice(0, SERIES - 1), rest = lg.slice(SERIES - 1).reduce((t, x) => t + x[1], 0), tl = lg.reduce((t, x) => t + x[1], 0);
  const top = [...own].sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0)).slice(0, 14);
  const yearly: Record<string, number> = {}; own.forEach(r => { const y = r.created_at.slice(0, 4); yearly[y] = (yearly[y] || 0) + 1; });
  const fresh = own.filter(r => (Date.now() - new Date(r.pushed_at).getTime()) / 864e5 < 90).length;
  return <div className="page">
    <header className="head"><img src={`${info.avatar_url}&s=104`} alt="" width="52" height="52" /><div><h1><a href={info.html_url} target="_blank" rel="noopener">{info.name || info.login}</a></h1>{info.bio && <p>{info.bio}</p>}<div className="meta"><span className="mono">@{info.login}</span><span>{info.type === "Organization" ? "Organization" : "User"}</span>{info.location && <span>{info.location}</span>}<span>Joined {date(info.created_at)}</span></div></div></header>
    <dl className="tiles">
      <Tile k="Stars" v={compact(sum("stargazers_count"))} sub="across original repositories" />
      <Tile k="Repositories" v={fmt(info.public_repos)} sub={`${fmt(own.length)} original of the ${fmt(repos.length)} loaded`} />
      <Tile k="Forks received" v={compact(sum("forks_count"))} />
      <Tile k="Active in 90 days" v={fmt(fresh)} sub="repositories pushed to" />
      <Tile k="Followers" v={compact(info.followers)} />
    </dl>
    <div className="grid gap">
      {lg.length > 0 && <Card c="c12" title="Languages" sub="By number of repositories"><div className="strip" role="img" aria-label="Repositories by language">{head.map(([n, c], i) => <i key={n} data-tip={`${n}: ${c} repositories`} style={{ flex: c, background: slot(i) }} />)}{rest > 0 && <i style={{ flex: rest, background: "var(--rest)" }} />}</div><ul className="legend">{head.map(([n, c], i) => <li key={n}><em style={{ background: slot(i) }} />{n} <small>{pct(c, tl, 0)}</small></li>)}{rest > 0 && <li><em style={{ background: "var(--rest)" }} />Other <small>{pct(rest, tl, 0)}</small></li>}</ul></Card>}
      <Card c="c8" title="Top repositories" sub="Select one for the full report"><div className="scroll"><table><thead><tr><th>Repository</th><th>Language</th><th>Stars</th><th>Forks</th><th>Last push</th></tr></thead><tbody>{top.map(r => <tr key={r.full_name}><td><button className="chip" onClick={() => go(r.full_name)}>{r.name}</button></td><td>{r.language || "–"}</td><Num>{fmt(r.stargazers_count)}</Num><Num>{fmt(r.forks_count)}</Num><td>{date(r.pushed_at)}</td></tr>)}</tbody></table></div></Card>
      <Card c="c4" title="Repositories created" sub="Per year"><Columns w={360} h={220} label="Repositories created per year" data={Object.entries(yearly).sort().slice(-8).map(([y, n]) => ({ label: y, value: n, tip: `${y}: ${n} repositories` }))} /></Card>
    </div>
  </div>;
}
