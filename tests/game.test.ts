import { test } from "vitest";
import assert from "node:assert/strict";
import { BADGES, COMMIT_CAP, derive, fromGraphQL, levelOf, score, titleOf, toRow, xpForLevel, xpOf, type PlayerInput } from "../supabase/functions/_shared/game";
import { repoArena } from "../src/core/arena";

const day = (date: string, count: number) => ({ date, count });
const base = (over: Partial<PlayerInput> = {}): PlayerInput => ({ login: "ann", name: "Ann", avatar: "a", followers: 3, commits: 0, prs: 0, reviews: 0, issues: 0, days: [], repos: [], ...over });

test("streaks survive until today is over, and the longest run is kept", () => {
  const s = derive(base({ days: [day("2026-01-01", 1), day("2026-01-02", 2), day("2026-01-03", 1), day("2026-01-04", 0), day("2026-01-05", 3), day("2026-01-06", 1), day("2026-01-07", 0)] }), "2026-01-07");
  assert.deepEqual([s.streak, s.longestStreak, s.contributions, s.activeDays], [2, 3, 8, 5]);
  assert.equal(derive(base({ days: [day("2026-01-06", 1), day("2026-01-07", 0)] }), "2026-01-08").streak, 1);
});

test("huge commits are capped, and stars count only owned repositories", () => {
  const s = derive(base({ repos: [
    { name: "ann/a", stars: 40, owned: true, languages: { Go: 900, Rust: 100 }, commits: [{ at: "2026-01-03T02:00:00Z", add: 50000, del: 10 }, { at: "2026-01-05T12:00:00Z", add: 100, del: 5 }] },
    { name: "org/b", stars: 900, owned: false, languages: { Go: 100 }, commits: [] }
  ] }));
  assert.equal(s.linesAdded, COMMIT_CAP + 100);
  assert.equal(s.stars, 40);
  assert.deepEqual([s.topLanguage, s.languages.Go], ["Go", 1000]);
  assert.equal(s.nightShare, .5);
  assert.equal(s.weekendShare, .5);
});

test("weekly totals are grouped from the most recent day", () => {
  const days = Array.from({ length: 14 }, (_, i) => day(`2026-02-${String(i + 1).padStart(2, "0")}`, i < 7 ? 1 : 2));
  assert.deepEqual(derive(base({ days }), "2026-02-14").weekly, [7, 14]);
  assert.equal(derive(base({ days }), "2026-02-14").week, 14);
});

test("levels follow the XP curve", () => {
  assert.deepEqual([0, 99, 100, 399, 400, 10000].map(levelOf), [1, 1, 2, 2, 3, 11]);
  assert.equal(xpForLevel(levelOf(2500)), 2500);
  assert.deepEqual([titleOf(1), titleOf(5), titleOf(10), titleOf(40)], ["Hello World", "Apprentice", "Maintainer", "Mythic"]);
  assert.equal(xpOf({ linesAdded: 1000, linesDeleted: 200, commits: 10, prs: 2, reviews: 1, issues: 1, stars: 2, longestStreak: 3 }), 100 + 10 + 100 + 50 + 20 + 8 + 10 + 45);
});

test("badges unlock at their goals and report progress", () => {
  const s = derive(base({ commits: 120, reviews: 5, days: Array.from({ length: 8 }, (_, i) => day(`2026-03-0${i + 1}`, 1)) }), "2026-03-08");
  const sc = score(s), b = Object.fromEntries(sc.badges.map(x => [x.id, x]));
  assert.equal(b.centurion.earned, true);
  assert.equal(b["on-a-roll"].earned, true);
  assert.equal(b.unstoppable.earned, false);
  assert.equal(b.reviewer.progress, .2);
  assert.equal(sc.badges.length, BADGES.length);
  assert.ok(sc.progress >= 0 && sc.progress < 1);
  assert.equal(b["night-owl"].value, 0, "too few commits to judge working hours");
});

test("fromGraphQL and toRow turn the API answer into a stored row", () => {
  const v = { login: "Ann", name: null, avatarUrl: "x", followers: { totalCount: 2 }, contributionsCollection: { totalCommitContributions: 5, totalPullRequestContributions: 1, totalPullRequestReviewContributions: 0, totalIssueContributions: 2, contributionCalendar: { weeks: [{ contributionDays: [{ date: "2026-01-01", contributionCount: 3 }] }] } }, repositories: { nodes: [{ nameWithOwner: "ann/x", stargazerCount: 7, languages: { edges: [{ size: 10, node: { name: "Go" } }] }, defaultBranchRef: { target: { history: { nodes: [{ committedDate: "2026-01-01T10:00:00Z", additions: 30, deletions: 4 }] } } } }, { nameWithOwner: "empty/repo", stargazerCount: 0, languages: { edges: [] }, defaultBranchRef: null }] } };
  const p = fromGraphQL(v), s = derive(p, "2026-01-01"), row = toRow(p, s, score(s));
  assert.equal(p.repos[0].owned, true);
  assert.deepEqual(p.repos[1].commits, []);
  assert.deepEqual([row.lines_added, row.commits, row.stars, row.top_language, row.contributions], [30, 5, 7, "Go", 3]);
  assert.ok(Array.isArray(row.badges) && row.weekly.length === 1);
});

test("repoArena ranks a repository's authors and hands out badges", () => {
  const w = (week: number, a: number, d: number, c: number) => ({ w: week, a, d, c });
  const now = Date.parse("2026-06-01T00:00:00Z"), s = now / 1000, wk = 604800;
  const rows = repoArena([
    { total: 30, author: { login: "old", avatar_url: "", html_url: "" }, weeks: [w(s - 300 * wk, 5000, 100, 20), w(s - 299 * wk, 100, 9000, 10)] },
    { total: 12, author: { login: "new", avatar_url: "", html_url: "" }, weeks: Array.from({ length: 10 }, (_, i) => w(s - (10 - i) * wk, 50, 5, 1)).concat([w(s - wk / 2, 0, 0, 2)]) },
    { total: 1, author: null, weeks: [] }
  ], now);
  assert.deepEqual(rows.map(r => r.login), ["old", "new"]);
  assert.ok(rows[0].badges.includes("Founder") && rows[0].badges.includes("Refactorer"));
  assert.ok(rows[1].badges.includes("Rising star") && rows[1].badges.includes("Streaker"));
  assert.equal(rows[1].recent, 12);
});
