// The global leaderboard, player cards and the per-repository leaderboard.
import { useEffect, useMemo, useState } from "react";
import { useApp } from "../app/App";
import { BOARDS, playerByLogin, playerCount, rankOf, supabase, topPlayers, type Board, type PlayerRow } from "../lib/supabase";
import { badgeInfo, xpForLevel } from "../../supabase/functions/_shared/game.ts";
import { REPO_BOARDS, repoArena, type RepoPlayer } from "../core/arena";
import type { Report } from "../core/types";
import { compact, date, fmt, saveFile } from "../lib/util";
import { Sparkline, slot } from "../ui/charts";
import { Card, Empty, PixelIcon, Tile } from "../ui/parts";

const metric = (p: PlayerRow, b: Board) => p[b] as number;
const unit = (b: Board) => BOARDS.find(x => x[0] === b)![2];

export function Level({ level, small }: { level: number; small?: boolean }) {
  return <span className={"lvl" + (small ? " sm" : "")} title={`Level ${level}`}>LV {level}</span>;
}

function XpBar({ xp, level }: { xp: number; level: number }) {
  const floor = xpForLevel(level), next = xpForLevel(level + 1), p = Math.max(0, Math.min(1, (xp - floor) / (next - floor)));
  return <div className="xpbar" role="img" aria-label={`${fmt(xp - floor)} of ${fmt(next - floor)} XP to level ${level + 1}`}><i style={{ width: `${p * 100}%` }} /><span>{fmt(xp)} XP · {fmt(next - xp)} to level {level + 1}</span></div>;
}

// first place stands in the middle and highest
function Podium<T>({ rows, value, name, avatar, href }: { rows: T[]; value: (r: T) => string; name: (r: T) => string; avatar: (r: T) => string; href: (r: T) => string }) {
  const order = [1, 0, 2].filter(i => rows[i]);
  return <div className="podium">{order.map(i => { const r = rows[i]; return <a key={name(r)} className={"step p" + (i + 1)} href={href(r)}>
    <img src={avatar(r)} alt="" width="56" height="56" />{i === 0 && <span className="crown"><PixelIcon name="trophy" size={28} /></span>}
    <strong>{name(r)}</strong><small>{value(r)}</small><b>{i + 1}</b>
  </a>; })}</div>;
}

function SetupNotice() {
  return <Card c="c12" title="Leaderboard setup"><div className="cta"><h3>Sign-in isn’t switched on for this site yet</h3>
    <p>The global leaderboard needs a free Supabase project with GitHub sign-in. Follow <b>LEADERBOARD.md</b> in the repository, then add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> and rebuild. Repository leaderboards work without it, on the Leaderboard tab of any report.</p></div></Card>;
}

export function ArenaPage() {
  const { auth } = useApp(), [board, setBoard] = useState<Board>("xp"), [rows, setRows] = useState<PlayerRow[] | null>(null), [err, setErr] = useState(""), [total, setTotal] = useState<number | null>(null), [myRank, setMyRank] = useState<number | null>(null);
  useEffect(() => { document.title = "Leaderboard · GitMetrics"; }, []);
  useEffect(() => {
    if (!supabase) return;
    setRows(null); setErr("");
    topPlayers(board).then(setRows, e => setErr(e.message));
    playerCount().then(setTotal, () => {});
  }, [board, auth.me?.updated_at]);
  useEffect(() => { if (auth.me) rankOf(board, metric(auth.me, board)).then(setMyRank, () => {}); else setMyRank(null); }, [board, auth.me]);
  if (!supabase) return <div className="page"><header className="head"><div><h1>Leaderboard</h1><p>Sign in with GitHub, earn XP from a year of real work, and climb the board.</p></div></header><div className="grid"><SetupNotice /></div></div>;
  const me = auth.me, label = BOARDS.find(b => b[0] === board)![1];
  return <div className="page arena">
    <header className="head"><div><h1>Leaderboard</h1><p>Ranked from each player’s last 12 months on GitHub, recomputed on the server so scores can’t be faked.{total != null ? ` ${fmt(total)} ${total === 1 ? "player" : "players"} so far.` : ""}</p></div>
      <div className="headact">{auth.session ? <button className="btn" onClick={() => auth.sync(true)} disabled={auth.syncing}>{auth.syncing ? "Scoring…" : "Update my score"}</button> : <button className="btn pri" onClick={auth.signIn}>Sign in with GitHub</button>}</div>
    </header>
    {auth.error && <div className="alert"><p>{auth.error}</p></div>}
    {me && <section className="card mecard"><img src={me.avatar} alt="" width="64" height="64" /><div><div className="mename"><a href={`#player/${me.login}`}>{me.name || me.login}</a><Level level={me.level} /><span className="ttl">{me.title}</span></div><XpBar xp={me.xp} level={me.level} /></div><div className="merank"><b>#{myRank ?? "…"}</b><small>in {label.toLowerCase()}</small></div></section>}
    {!auth.session && <section className="card join"><PixelIcon name="trophy" size={48} /><div><h3>Join the board</h3><p>Sign in with GitHub to get your level, XP and badges. GitMetrics reads public activity only, and you can leave anytime.</p></div><button className="btn pri" onClick={auth.signIn}>Sign in with GitHub</button></section>}
    <nav className="rail" aria-label="Leaderboards">{BOARDS.map(([k, l]) => <button key={k} aria-pressed={k === board} className={k === board ? "on" : ""} onClick={() => setBoard(k)}><span>{l}</span></button>)}</nav>
    {err ? <div className="alert"><p>{err}</p></div> : !rows ? <Card c="c12"><Empty>Loading the board…</Empty></Card> : !rows.length ? <Card c="c12"><Empty>Nobody is here yet. Sign in to take first place.</Empty></Card> : <>
      <Podium rows={rows.slice(0, 3)} name={r => r.login} avatar={r => r.avatar} href={r => `#player/${r.login}`} value={r => `${compact(metric(r, board))} ${unit(board)}`} />
      <Card c="c12" title={label}><div className="scroll"><table className="board-t"><thead><tr><th>#</th><th>Player</th><th>Level</th><th>{label}</th><th>Top language</th><th>Last 26 weeks</th></tr></thead><tbody>
        {rows.map((r, i) => <tr key={r.id} className={me && r.id === me.id ? "you" : undefined}><td className="num rank">{i + 1}</td><td><a className="who" href={`#player/${r.login}`}><img src={r.avatar} alt="" width="24" height="24" loading="lazy" />{r.login}</a></td><td><Level level={r.level} small /> <span className="mute">{r.title}</span></td><td className="num">{fmt(metric(r, board))}</td><td>{r.top_language || "–"}</td><td><Sparkline values={r.weekly.length ? r.weekly : [0]} w={96} h={22} /></td></tr>)}
      </tbody></table></div></Card>
    </>}
  </div>;
}

function playerCard(p: PlayerRow) {
  const esc = (s: string) => s.replace(/[&<>"]/g, "");
  const earned = badgeInfo(p.badges).filter(b => b.earned).length;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="495" height="190" viewBox="0 0 495 190" role="img" aria-label="${esc(p.login)}: level ${p.level}"><rect x="1" y="1" width="493" height="188" fill="#fff" stroke="#111" stroke-width="2"/><rect x="1" y="1" width="493" height="26" fill="#111"/><g font-family="Menlo,Consolas,monospace"><text x="14" y="19" font-size="13" fill="#fff">GITMETRICS PLAYER CARD</text><text x="20" y="62" font-size="22" font-weight="700" fill="#111">${esc(p.login)}</text><text x="20" y="84" font-size="13" fill="#5C5C58">Level ${p.level} · ${esc(p.title)} · ${fmt(p.xp)} XP</text><text x="20" y="124" font-size="20" fill="#111">${compact(p.lines_added)}</text><text x="20" y="142" font-size="11" fill="#5C5C58">LINES WRITTEN</text><text x="140" y="124" font-size="20" fill="#111">${compact(p.commits)}</text><text x="140" y="142" font-size="11" fill="#5C5C58">COMMITS</text><text x="250" y="124" font-size="20" fill="#111">${p.longest_streak}d</text><text x="250" y="142" font-size="11" fill="#5C5C58">BEST STREAK</text><text x="370" y="124" font-size="20" fill="#111">${earned}</text><text x="370" y="142" font-size="11" fill="#5C5C58">BADGES</text><text x="20" y="174" font-size="11" fill="#5C5C58">Last 12 months on GitHub</text></g><rect x="420" y="40" width="58" height="58" fill="#FFD23F" stroke="#111" stroke-width="2"/><text x="449" y="78" font-family="Menlo,monospace" font-size="24" font-weight="700" text-anchor="middle" fill="#111">${p.level}</text></svg>`;
}

export function PlayerPage({ login }: { login: string }) {
  const { auth } = useApp(), [p, setP] = useState<PlayerRow | null | undefined>(undefined), [rank, setRank] = useState<number | null>(null), [err, setErr] = useState("");
  useEffect(() => {
    document.title = `${login} · GitMetrics`;
    if (!supabase) return;
    setP(undefined); setErr("");
    playerByLogin(login).then(r => { setP(r); if (r) rankOf("xp", r.xp).then(setRank, () => {}); }, e => setErr(e.message));
  }, [login, auth.me?.updated_at]);
  if (!supabase) return <div className="page"><div className="grid"><SetupNotice /></div></div>;
  if (err) return <div className="page"><div className="alert"><p>{err}</p></div></div>;
  if (p === undefined) return <div className="page"><Card c="c12"><Empty>Loading player…</Empty></Card></div>;
  const mine = auth.me && p && auth.me.id === p.id;
  if (!p) return <div className="page"><Card c="c12" title="Player not found"><div className="cta"><p><b>{login}</b> hasn’t joined the leaderboard yet.</p>{!auth.session && <button className="btn pri" onClick={auth.signIn}>Sign in with GitHub</button>}<a className="btn" href="#arena">See the leaderboard</a></div></Card></div>;
  const badges = badgeInfo(p.badges), langs = Object.entries(p.languages), lt = langs.reduce((t, x) => t + x[1], 0);
  const vs = auth.me && !mine ? auth.me : null;
  const stat = (k: string, v: number, mineV?: number) => <Tile k={k} v={compact(v)} sub={vs && mineV != null ? <>{mineV > v ? "You lead by " : mineV < v ? "You trail by " : "Tied with you"}{mineV !== v && <b>{compact(Math.abs(mineV - v))}</b>}</> : undefined} />;
  return <div className="page">
    <section className="card hero-card">
      <img className="pfp" src={p.avatar + "&s=200"} alt="" width="104" height="104" />
      <div className="pinfo">
        <h1>{p.name || p.login}</h1>
        <div className="meta"><a href={`https://github.com/${p.login}`} target="_blank" rel="noopener">@{p.login}</a><span className="ttl">{p.title}</span>{rank && <span>#{rank} overall</span>}<span>Updated {date(p.updated_at)}</span></div>
        <XpBar xp={p.xp} level={p.level} />
      </div>
      <div className="biglvl"><small>LEVEL</small><b>{p.level}</b></div>
      <div className="headact">
        {mine && <button className="btn" disabled={auth.syncing} onClick={() => auth.sync(true)}>{auth.syncing ? "Scoring…" : "Update score"}</button>}
        <button className="btn" onClick={() => saveFile(`${p.login}-gitmetrics-card.svg`, "image/svg+xml", playerCard(p))}>Player card (SVG)</button>
        <a className="btn" href="#arena">Leaderboard</a>
        {mine && <button className="btn" onClick={() => { if (confirm("Leave the leaderboard? Your row is deleted, and you can rejoin by signing in again.")) auth.leave(); }}>Leave</button>}
      </div>
    </section>
    <dl className="tiles" style={{ marginTop: 14 }}>
      {stat("Lines written", p.lines_added, vs?.lines_added)}{stat("Commits", p.commits, vs?.commits)}{stat("Pull requests", p.prs, vs?.prs)}{stat("Reviews", p.reviews, vs?.reviews)}{stat("Longest streak", p.longest_streak, vs?.longest_streak)}{stat("Stars", p.stars, vs?.stars)}
    </dl>
    <div className="grid gap">
      <Card c="c8" title="Badges" sub={`${badges.filter(b => b.earned).length} of ${badges.length} unlocked`}><div className="badges">{badges.map(b => <div key={b.id} className={"badge" + (b.earned ? " got" : "")} title={b.desc}><PixelIcon name={b.icon} size={36} /><strong>{b.name}</strong><small>{b.desc}</small></div>)}</div></Card>
      <Card c="c4 wide-md" title="Activity" sub={`${fmt(p.contributions)} contributions · ${fmt(p.week)} this week`}><Sparkline values={p.weekly.length ? p.weekly : [0]} w={300} h={80} /><p className="note">Weekly contributions over the last 26 weeks. Current streak: {p.streak} {p.streak === 1 ? "day" : "days"}.</p></Card>
      {langs.length > 0 && <Card c="c12" title="Languages" sub="By code size across their repositories"><div className="strip">{langs.map(([n, v], i) => <i key={n} data-tip={`${n}: ${Math.round(v / lt * 100)}%`} style={{ flex: v, background: slot(i) }} />)}</div><ul className="legend">{langs.map(([n, v], i) => <li key={n}><em style={{ background: slot(i) }} />{n} <small>{Math.round(v / lt * 100)}%</small></li>)}</ul></Card>}
    </div>
    <p className="note">Scores use public GitHub activity from the last 12 months. Lines are read from up to 100 commits in each of the 40 most recently pushed repositories, and single commits count for at most 2,000 lines.</p>
  </div>;
}

const REPO_UNIT: Record<string, string> = { xp: "XP", add: "lines", commits: "commits", recent: "commits", net: "lines" };
export function RepoBoard({ d }: { d: Report }) {
  const rows = useMemo(() => repoArena(d.authors), [d.authors]), [board, setBoard] = useState<keyof RepoPlayer>("xp");
  if (!rows.length) return <Card c="c12"><Empty>{d.syncing ? "GitHub is preparing per-author statistics. The leaderboard appears when they’re ready." : "Per-author statistics aren’t available for this repository yet. Refresh in a minute."}</Empty></Card>;
  const sorted = [...rows].sort((a, b) => (b[board] as number) - (a[board] as number)), label = REPO_BOARDS.find(x => x[0] === board)![1];
  return <>
    <nav className="rail" aria-label="Repository leaderboards">{REPO_BOARDS.map(([k, l]) => <button key={k} aria-pressed={k === board} className={k === board ? "on" : ""} onClick={() => setBoard(k)}><span>{l}</span></button>)}</nav>
    <Podium rows={sorted.slice(0, 3)} name={r => r.login} avatar={r => r.avatar + "&s=112"} href={r => r.url} value={r => `${compact(r[board] as number)} ${REPO_UNIT[board]}`} />
    <Card c="c12" title={label} sub="From GitHub’s weekly statistics for the top 100 authors. Weekly totals count at most 10,000 lines."><div className="scroll"><table className="board-t"><thead><tr><th>#</th><th>Author</th><th>Level</th><th>{label}</th><th>Badges</th><th>Last 26 weeks</th></tr></thead><tbody>
      {sorted.slice(0, 50).map((r, i) => <tr key={r.login}><td className="num rank">{i + 1}</td><td><a className="who" href={r.url} target="_blank" rel="noopener"><img src={r.avatar + "&s=48"} alt="" width="24" height="24" loading="lazy" />{r.login}</a></td><td><Level level={r.level} small /> <span className="mute">{r.title}</span></td><td className="num">{fmt(r[board] as number)}</td><td className="wrap">{r.badges.map(b => <span key={b} className="tag">{b}</span>)}</td><td><Sparkline values={r.spark} w={96} h={22} /></td></tr>)}
    </tbody></table></div></Card>
  </>;
}
