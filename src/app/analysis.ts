// Report loading and caching, plus what the app remembers between visits.
import { analyzeRepo, RateLimitError, rate } from "../core/github";
import { summarize } from "../core/metrics";
import type { Report, Snapshot } from "../core/types";
import { fmt, runCount, store } from "../lib/util";

const TTL = 600000, CACHE = new Map<string, { d: Report; at: number }>();
export interface RepoSpec { o: string; n: string; ref: string }
export type Step = (id: string, state: "run" | "done", note?: string, frac?: number) => void;

const cacheKey = (p: RepoSpec, vendor: boolean) => `${p.o}/${p.n}@${p.ref}|${vendor}`.toLowerCase();
// sessions survive a reload, so reopening a report doesn't spend rate limit. Very large reports simply don't fit.
const sessionGet = (key: string) => { try { const v = JSON.parse(sessionStorage.getItem("gm.r:" + key) || "null"); return v && Date.now() - v.at < TTL ? v as { d: Report; at: number } : null; } catch { return null; } };
export const sessionPut = (key: string, d: Report) => { try { sessionStorage.clear(); sessionStorage.setItem("gm.r:" + key, JSON.stringify({ d, at: Date.now() })); } catch { /* too large to keep */ } };

export async function loadRepo(p: RepoSpec, token: string, vendor: boolean, onStep: Step, signal: AbortSignal) {
  const key = cacheKey(p, vendor), hit = CACHE.get(key) || sessionGet(key);
  if (hit && Date.now() - hit.at < TTL) { CACHE.set(key, hit); return hit.d; }
  const d = await analyzeRepo({ ...p, token, vendor, signal, onStep, count: (spec, progress) => runCount({ kind: "remote", spec }, progress, signal) });
  d.wantRef = p.ref; d.key = key; CACHE.set(key, { d, at: Date.now() }); sessionPut(key, d);
  return d;
}
export function dropCache(d: Report) { if (d.key) CACHE.delete(d.key); try { sessionStorage.clear(); } catch { /* storage may be blocked */ } }

const delta = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "±") + fmt(Math.abs(n));
const histKey = (name: string) => `gm.hist:${name}`.toLowerCase();

// compare with the last visit, then record this one
export function remember(d: Report) {
  const S = summarize(d), k = histKey(`${d.o}/${d.n}`), prev = store.get<Snapshot | null>(k, null);
  const now: Snapshot = { lines: S.total, stars: d.m.stargazers_count, commits: d.commits, health: S.health && S.health.score, at: Date.now() };
  now.series = [...((prev && prev.series) || []), now.health].filter((x): x is number => x != null).slice(-30);
  if (prev) {
    d.history = prev;
    if (now.at - prev.at > 36e5) d.since = `Last visit ${new Date(prev.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}: lines ${delta(now.lines - prev.lines)}, stars ${delta((now.stars || 0) - (prev.stars || 0))}${now.commits != null && prev.commits != null ? ", commits " + delta(now.commits - prev.commits) : ""}${now.health != null && prev.health != null ? ", health " + delta(now.health - prev.health) : ""}.`;
  }
  store.set(k, now);
  const name = `${d.o}/${d.n}`, rec = store.get<Recent[]>("gm.recent", []).filter(r => r.name.toLowerCase() !== name.toLowerCase());
  store.set("gm.recent", [{ name, lines: S.total, grade: S.health && S.health.grade }, ...rec].slice(0, 6));
}

export interface Recent { name: string; lines?: number; grade?: string | null }
export const recents = () => store.get<Recent[]>("gm.recent", []);
export const watchNames = () => store.get<string[]>("gm.watch", []);
export const watchlist = () => watchNames().map(name => ({ name, ...store.get<Partial<Snapshot>>(histKey(name), {}) }));
export function toggleWatch(name: string) {
  const list = watchNames(), on = list.includes(name);
  store.set("gm.watch", on ? list.filter(x => x !== name) : [name, ...list].slice(0, 12));
  return !on;
}

export const deepLimit = (token: string) => Math.max(5, Math.min(token ? 100 : 30, (rate.remaining ?? 60) - 5));
export const errorText = (e: unknown, step: string) => { const x = e as Error; return x.name !== "TypeError" && x.message ? x.message : `The browser couldn’t reach GitHub while ${step}. Check your connection, and turn off any blocker for api.github.com or raw.githubusercontent.com.`; };
export const isLimit = (e: unknown) => e instanceof RateLimitError;

export function parseRepo(v: string): RepoSpec | null {
  const p = v.trim().replace(/^https?:\/\/(www\.)?github\.com\//, "").split(/[?#]/)[0].replace(/\.git$/, "").split("/");
  if (p.length < 2 || !p[0] || !p[1]) return null;
  let ref = ""; try { ref = p[2] === "tree" && p[3] ? decodeURIComponent(p.slice(3).join("/")) : ""; } catch { /* keep the default branch */ }
  const [name, at] = p[1].split("@");
  return { o: p[0], n: name, ref: ref || at || "" };
}

export type Route =
  | { kind: "home" } | { kind: "repo"; spec: RepoSpec; tab: string } | { kind: "vs"; list: string[] } | { kind: "user"; user: string }
  | { kind: "pr"; o: string; n: string; num: string } | { kind: "local" } | { kind: "arena" } | { kind: "player"; login: string };

export function readHash(): Route {
  const h = decodeURIComponent(location.hash.slice(1));
  if (!h) return { kind: "home" };
  if (h === "arena") return { kind: "arena" };
  if (h.startsWith("player/")) return { kind: "player", login: h.slice(7) };
  if (h.startsWith("pr/")) { const [o, n, num] = h.slice(3).split("/"); return { kind: "pr", o, n, num }; }
  if (h.startsWith("vs/")) return { kind: "vs", list: h.slice(3).split("+") };
  if (h.startsWith("@")) return { kind: "user", user: h.slice(1) };
  const [spec, t] = h.split("~"), [r, ref] = spec.split("@"), p = parseRepo(r);
  return p ? { kind: "repo", spec: { ...p, ref: ref || p.ref }, tab: t || "overview" } : { kind: "home" };
}

// turns what someone typed into a location, or null when it can't be understood
export function inputToHash(raw: string): string | null {
  const v = raw.trim(); if (!v) return null;
  const pr = v.match(/^(?:https?:\/\/(?:www\.)?github\.com\/)?([\w.-]+)\/([\w.-]+)(?:\/pull\/|#)(\d+)/);
  if (pr) return `pr/${pr[1]}/${pr[2]}/${pr[3]}`;
  const parts = v.split(/[,\s]+/).filter(x => x && !/^vs$/i.test(x));
  if (parts.length > 1) { const list = parts.slice(0, 4).map(parseRepo); return list.every(Boolean) ? "vs/" + list.map(s => `${s!.o}/${s!.n}`).join("+") : null; }
  if (/^@?[\w.-]+\/?$/.test(v)) return "@" + v.replace(/^@|\/$/g, "");
  const p = parseRepo(v);
  return p ? `${p.o}/${p.n}${p.ref ? "@" + p.ref : ""}` : null;
}
