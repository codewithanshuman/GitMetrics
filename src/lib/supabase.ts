// Sign-in and the global leaderboard. Everything here is optional: without Supabase settings the app runs as before.
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined, key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const supabase: SupabaseClient | null = url && key ? createClient(url, key, { auth: { flowType: "pkce", persistSession: true, detectSessionInUrl: true } }) : null;
export type { Session };

export interface PlayerRow {
  id: string; login: string; name: string | null; avatar: string; xp: number; level: number; title: string;
  lines_added: number; lines_deleted: number; commits: number; prs: number; reviews: number; issues: number; contributions: number;
  week: number; streak: number; longest_streak: number; stars: number; followers: number; top_language: string | null;
  languages: Record<string, number>; badges: string[]; weekly: number[]; updated_at: string;
}
export type Board = "xp" | "lines_added" | "commits" | "week" | "longest_streak" | "stars";
export const BOARDS: [Board, string, string][] = [["xp", "XP", "XP"], ["lines_added", "Lines written", "lines"], ["commits", "Commits", "commits"], ["week", "This week", "contributions"], ["longest_streak", "Longest streak", "days"], ["stars", "Stars", "stars"]];

const need = () => { if (!supabase) throw new Error("The leaderboard isn’t set up on this site yet."); return supabase; };

export async function topPlayers(board: Board, limit = 100) {
  const { data, error } = await need().from("players").select("*").order(board, { ascending: false }).order("xp", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return data as PlayerRow[];
}
export async function playerByLogin(login: string) {
  const { data, error } = await need().from("players").select("*").ilike("login", login.replace(/[%_]/g, "")).maybeSingle();
  if (error) throw new Error(error.message);
  return data as PlayerRow | null;
}
export async function playerById(id: string) {
  const { data } = await need().from("players").select("*").eq("id", id).maybeSingle();
  return data as PlayerRow | null;
}
// rank = how many players beat this value, plus one
export async function rankOf(board: Board, value: number) {
  const { count } = await need().from("players").select("id", { count: "exact", head: true }).gt(board, value);
  return (count ?? 0) + 1;
}
export async function playerCount() {
  const { count } = await need().from("players").select("id", { count: "exact", head: true });
  return count ?? 0;
}

export async function syncScore(providerToken: string, force = false) {
  const { data, error } = await need().functions.invoke("score", { body: { provider_token: providerToken, force } });
  if (error) {
    let msg = error.message;
    try { const body = await (error as { context?: Response }).context?.json(); if (body?.error) msg = body.error; } catch { /* keep the generic message */ }
    throw new Error(msg);
  }
  return data as PlayerRow;
}

export const signIn = (back = "#arena") => need().auth.signInWithOAuth({ provider: "github", options: { redirectTo: location.origin + location.pathname + back, scopes: "read:user" } });
export const signOut = () => need().auth.signOut();
export async function leaveBoard(id: string) {
  const { error } = await need().from("players").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
