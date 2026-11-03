// The per-repository leaderboard, built from GitHub's weekly statistics for each author.
import { COMMIT_CAP, levelOf, titleOf } from "../../supabase/functions/_shared/game.ts";
import type { AuthorStat } from "./types";

export interface RepoPlayer { login: string; avatar: string; url: string; xp: number; level: number; title: string; commits: number; add: number; del: number; net: number; recent: number; activeWeeks: number; bestRun: number; first: number; badges: string[]; spark: number[] }
export const REPO_BOARDS: [keyof RepoPlayer, string][] = [["xp", "XP"], ["add", "Lines written"], ["commits", "Commits"], ["recent", "Last 90 days"], ["net", "Net lines"]];

export function repoArena(authors: AuthorStat[] | null | undefined, now = Date.now()): RepoPlayer[] {
  if (!authors) return [];
  const cut = now / 1000 - 90 * 86400;
  const rows = authors.filter(a => a.author).map(a => {
    const live = a.weeks.filter(w => w.c);
    // weekly totals can hide a single giant commit, so each week is capped too
    const add = a.weeks.reduce((t, w) => t + Math.min(w.a, COMMIT_CAP * 5), 0), del = a.weeks.reduce((t, w) => t + Math.min(w.d, COMMIT_CAP * 5), 0);
    let run = 0, bestRun = 0; for (const w of a.weeks) { run = w.c ? run + 1 : 0; bestRun = Math.max(bestRun, run); }
    const xp = Math.round(add * .1 + del * .05 + a.total * 10), level = levelOf(xp);
    return {
      login: a.author!.login, avatar: a.author!.avatar_url, url: a.author!.html_url, xp, level, title: titleOf(level), commits: a.total, add, del, net: add - del,
      recent: a.weeks.filter(w => w.w >= cut).reduce((t, w) => t + w.c, 0), activeWeeks: live.length, bestRun, first: live.length ? live[0].w : Infinity, badges: [] as string[], spark: a.weeks.slice(-26).map(w => w.c)
    };
  });
  const top = (k: "first" | "recent" | "commits", low = false) => rows.length ? rows.reduce((b, r) => (low ? r[k] < b[k] : r[k] > b[k]) ? r : b) : null;
  const founder = top("first", true), rising = top("recent");
  if (founder && founder.first !== Infinity) founder.badges.push("Founder");
  if (rising && rising.recent > 0) rising.badges.push("Rising star");
  rows.forEach(r => {
    if (r.del >= 1000 && r.del > r.add) r.badges.push("Refactorer");
    if (r.activeWeeks >= 52) r.badges.push("Marathoner");
    if (r.bestRun >= 8) r.badges.push("Streaker");
    if (r.add >= 10000) r.badges.push("Line machine");
  });
  return rows.sort((a, b) => b.xp - a.xp);
}
