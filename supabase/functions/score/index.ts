// Scores the signed-in player from their own GitHub activity and saves the result.
// Scores are only ever written here, with the service role, so nobody can submit their own numbers.
import { createClient } from "npm:@supabase/supabase-js@2";
import { derive, fromGraphQL, PLAYER_QUERY, score, toRow } from "../_shared/game.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const COOLDOWN_MS = 10 * 60 * 1000;

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer /, "");
    const { data: { user } } = await admin.auth.getUser(jwt);
    if (!user) return reply({ error: "Sign in to join the leaderboard." }, 401);
    const { provider_token: token, force } = await req.json().catch(() => ({}));
    if (!token) return reply({ error: "Your GitHub session expired. Sign in again to update your score." }, 400);

    const gh = async (query: string, variables: Record<string, unknown> = {}) => {
      const r = await fetch("https://api.github.com/graphql", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "GitMetrics" }, body: JSON.stringify({ query, variables }) });
      const j = await r.json();
      if (!r.ok || j.errors) throw new Error(j.message || j.errors?.[0]?.message || `GitHub returned ${r.status}`);
      return j.data;
    };
    // the GitHub token must belong to the same account the player signed in with
    const me = (await gh("query { viewer { id databaseId login } }")).viewer;
    const github = user.identities?.find(i => i.provider === "github");
    if (!github || String(github.id) !== String(me.databaseId)) return reply({ error: "That GitHub token belongs to a different account." }, 403);

    const { data: existing } = await admin.from("players").select("*").eq("id", user.id).maybeSingle();
    if (existing && !force && Date.now() - new Date(existing.updated_at).getTime() < COOLDOWN_MS) return reply(existing);

    const year = new Date(Date.now() - 365 * 864e5).toISOString();
    const input = fromGraphQL((await gh(PLAYER_QUERY, { id: me.id, since: year, from: year })).viewer);
    const stats = derive(input), row = { id: user.id, ...toRow(input, stats, score(stats)) };
    const { data, error } = await admin.from("players").upsert(row).select().single();
    if (error) throw error;
    return reply(data);
  } catch (e) {
    return reply({ error: (e as Error).message || "Scoring failed." }, 500);
  }
});
