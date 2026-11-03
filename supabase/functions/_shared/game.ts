// Scoring for the leaderboards: XP, levels and badges.
// Shared by the web app and the Supabase scoring function, so it must stay plain TypeScript with no imports.

export interface CommitPoint { at: string; add: number; del: number }
export interface RepoActivity { name: string; stars: number; owned: boolean; languages: Record<string, number>; commits: CommitPoint[] }
export interface PlayerInput {
  login: string; name: string | null; avatar: string; followers: number;
  commits: number; prs: number; reviews: number; issues: number;
  days: { date: string; count: number }[]; repos: RepoActivity[];
}
export interface PlayerStats {
  linesAdded: number; linesDeleted: number; commits: number; prs: number; reviews: number; issues: number;
  contributions: number; week: number; streak: number; longestStreak: number; stars: number; activeDays: number;
  languages: Record<string, number>; topLanguage: string | null; weekly: number[]; nightShare: number; weekendShare: number; sampled: number;
}

// one huge commit (a vendored folder, a lock file) shouldn't buy the top spot
export const COMMIT_CAP = 2000;
const sum = (a: number[]) => a.reduce((t, x) => t + x, 0);

export function derive(p: PlayerInput, today = new Date().toISOString().slice(0, 10)): PlayerStats {
  const commits = p.repos.flatMap(r => r.commits);
  const days = [...p.days].filter(d => d.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  let longest = 0, run = 0;
  for (const d of days) { run = d.count ? run + 1 : 0; longest = Math.max(longest, run); }
  // today may not have its first contribution yet, so a streak survives until the day is over
  let i = days.length - 1, streak = 0;
  if (i >= 0 && !days[i].count) i--;
  while (i >= 0 && days[i].count) { streak++; i--; }
  const weekly: number[] = [];
  for (let end = days.length; end > 0 && weekly.length < 26; end -= 7) weekly.unshift(sum(days.slice(Math.max(0, end - 7), end).map(d => d.count)));
  const languages: Record<string, number> = {};
  p.repos.forEach(r => Object.entries(r.languages).forEach(([k, v]) => languages[k] = (languages[k] || 0) + v));
  const hours = commits.map(c => new Date(c.at));
  const share = (f: (d: Date) => boolean) => hours.length ? hours.filter(f).length / hours.length : 0;
  return {
    linesAdded: sum(commits.map(c => Math.min(c.add, COMMIT_CAP))), linesDeleted: sum(commits.map(c => Math.min(c.del, COMMIT_CAP))),
    commits: p.commits, prs: p.prs, reviews: p.reviews, issues: p.issues,
    contributions: sum(days.map(d => d.count)), week: sum(days.slice(-7).map(d => d.count)), streak, longestStreak: longest,
    activeDays: days.filter(d => d.count).length, stars: sum(p.repos.filter(r => r.owned).map(r => r.stars)),
    languages, topLanguage: Object.entries(languages).sort((a, b) => b[1] - a[1])[0]?.[0] || null, weekly,
    nightShare: share(d => d.getUTCHours() < 5), weekendShare: share(d => d.getUTCDay() === 0 || d.getUTCDay() === 6), sampled: commits.length
  };
}

export const xpOf = (s: Pick<PlayerStats, "linesAdded" | "linesDeleted" | "commits" | "prs" | "reviews" | "issues" | "stars" | "longestStreak">) =>
  Math.round(s.linesAdded * .1 + s.linesDeleted * .05 + s.commits * 10 + s.prs * 25 + s.reviews * 20 + s.issues * 8 + s.stars * 5 + s.longestStreak * 15);
export const levelOf = (xp: number) => Math.floor(Math.sqrt(Math.max(xp, 0) / 100)) + 1;
export const xpForLevel = (level: number) => 100 * (level - 1) ** 2;
const TITLES: [number, string][] = [[1, "Hello World"], [3, "Apprentice"], [6, "Builder"], [10, "Maintainer"], [15, "Architect"], [22, "Legend"], [30, "Mythic"]];
export const titleOf = (level: number) => [...TITLES].reverse().find(([l]) => level >= l)![1];

export interface BadgeDef { id: string; name: string; desc: string; icon: string; goal: number; value: (s: PlayerStats) => number }
export const BADGES: BadgeDef[] = [
  { id: "centurion", name: "Centurion", desc: "100 commits in a year", icon: "trophy", goal: 100, value: s => s.commits },
  { id: "line-machine", name: "Line machine", desc: "10,000 lines written", icon: "chart", goal: 10000, value: s => s.linesAdded },
  { id: "polyglot", name: "Polyglot", desc: "Code in 5 languages", icon: "folder", goal: 5, value: s => Object.keys(s.languages).length },
  { id: "on-a-roll", name: "On a roll", desc: "A 7-day streak", icon: "flame", goal: 7, value: s => s.longestStreak },
  { id: "unstoppable", name: "Unstoppable", desc: "A 30-day streak", icon: "flame", goal: 30, value: s => s.longestStreak },
  { id: "marathon", name: "Marathon", desc: "365 contributions in a year", icon: "floppy", goal: 365, value: s => s.contributions },
  { id: "shipper", name: "Shipper", desc: "50 pull requests", icon: "rocket", goal: 50, value: s => s.prs },
  { id: "reviewer", name: "Reviewer", desc: "25 code reviews", icon: "lens", goal: 25, value: s => s.reviews },
  { id: "bug-hunter", name: "Bug hunter", desc: "25 issues opened", icon: "bomb", goal: 25, value: s => s.issues },
  { id: "starstruck", name: "Starstruck", desc: "100 stars on your repos", icon: "star", goal: 100, value: s => s.stars },
  { id: "refactorer", name: "Refactorer", desc: "Delete more than you add", icon: "trash", goal: 100, value: s => s.linesDeleted >= 1000 && s.linesDeleted >= s.linesAdded ? 100 : Math.round(Math.min(s.linesDeleted / Math.max(s.linesAdded, 1), 1) * 99) },
  { id: "night-owl", name: "Night owl", desc: "30% of commits after midnight UTC", icon: "moon", goal: 30, value: s => s.sampled >= 20 ? Math.round(s.nightShare * 100) : 0 },
  { id: "weekend-warrior", name: "Weekend warrior", desc: "40% of commits on weekends", icon: "sun", goal: 40, value: s => s.sampled >= 20 ? Math.round(s.weekendShare * 100) : 0 }
];

export interface Score { xp: number; level: number; title: string; floor: number; next: number; progress: number; badges: { id: string; name: string; desc: string; icon: string; earned: boolean; progress: number; value: number; goal: number }[] }
export function score(s: PlayerStats): Score {
  const xp = xpOf(s), level = levelOf(xp), floor = xpForLevel(level), next = xpForLevel(level + 1);
  return {
    xp, level, title: titleOf(level), floor, next, progress: (xp - floor) / (next - floor),
    badges: BADGES.map(b => { const value = b.value(s); return { id: b.id, name: b.name, desc: b.desc, icon: b.icon, goal: b.goal, value, earned: value >= b.goal, progress: Math.min(1, value / b.goal) }; })
  };
}
export const badgeInfo = (ids: string[]) => BADGES.map(b => ({ id: b.id, name: b.name, desc: b.desc, icon: b.icon, earned: ids.includes(b.id) }));

// one GitHub GraphQL call returns a year of activity, including lines from up to 100 commits per repository
export const PLAYER_QUERY = `query($id: ID!, $since: GitTimestamp!, $from: DateTime!) {
  viewer {
    login name avatarUrl followers { totalCount }
    contributionsCollection(from: $from) {
      totalCommitContributions totalPullRequestContributions totalPullRequestReviewContributions totalIssueContributions
      contributionCalendar { weeks { contributionDays { date contributionCount } } }
    }
    repositories(first: 40, ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER], isFork: false, orderBy: {field: PUSHED_AT, direction: DESC}) {
      nodes {
        nameWithOwner stargazerCount
        languages(first: 8, orderBy: {field: SIZE, direction: DESC}) { edges { size node { name } } }
        defaultBranchRef { target { ... on Commit { history(first: 100, since: $since, author: {id: $id}) { nodes { committedDate additions deletions } } } } }
      }
    }
  }
}`;

// deno-lint-ignore no-explicit-any
export function fromGraphQL(v: any): PlayerInput {
  const c = v.contributionsCollection;
  return {
    login: v.login, name: v.name, avatar: v.avatarUrl, followers: v.followers.totalCount,
    commits: c.totalCommitContributions, prs: c.totalPullRequestContributions, reviews: c.totalPullRequestReviewContributions, issues: c.totalIssueContributions,
    // deno-lint-ignore no-explicit-any
    days: c.contributionCalendar.weeks.flatMap((w: any) => w.contributionDays.map((d: any) => ({ date: d.date, count: d.contributionCount }))),
    // deno-lint-ignore no-explicit-any
    repos: v.repositories.nodes.filter(Boolean).map((r: any) => ({
      name: r.nameWithOwner, stars: r.stargazerCount, owned: r.nameWithOwner.toLowerCase().startsWith(v.login.toLowerCase() + "/"),
      // deno-lint-ignore no-explicit-any
      languages: Object.fromEntries((r.languages?.edges || []).map((e: any) => [e.node.name, e.size])),
      // deno-lint-ignore no-explicit-any
      commits: (r.defaultBranchRef?.target?.history?.nodes || []).map((n: any) => ({ at: n.committedDate, add: n.additions, del: n.deletions }))
    }))
  };
}

// the row stored for each player. Column names match the players table.
export function toRow(p: PlayerInput, s: PlayerStats, sc: Score) {
  const top = Object.entries(s.languages).sort((a, b) => b[1] - a[1]).slice(0, 6);
  return {
    login: p.login, name: p.name, avatar: p.avatar, xp: sc.xp, level: sc.level, title: sc.title,
    lines_added: s.linesAdded, lines_deleted: s.linesDeleted, commits: s.commits, prs: s.prs, reviews: s.reviews, issues: s.issues,
    contributions: s.contributions, week: s.week, streak: s.streak, longest_streak: s.longestStreak, stars: s.stars, followers: p.followers,
    top_language: s.topLanguage, languages: Object.fromEntries(top), badges: sc.badges.filter(b => b.earned).map(b => b.id), weekly: s.weekly,
    updated_at: new Date().toISOString()
  };
}
