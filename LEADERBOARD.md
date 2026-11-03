# Setting up the global leaderboard

The global leaderboard uses a free [Supabase](https://supabase.com) project for GitHub sign-in, the scores table, and one server function that does the scoring. Without it, GitMetrics still works, and each repository report keeps its own leaderboard tab.

This takes about 15 minutes.

## How scoring stays honest

- A player signs in with GitHub through Supabase.
- The app sends the GitHub token from that sign-in to the `score` function.
- The function checks the token belongs to the signed-in account, then reads the last 12 months of public activity through GitHub's GraphQL API.
- It computes XP, level and badges with [supabase/functions/_shared/game.ts](supabase/functions/_shared/game.ts), the same code the app and tests use, and saves the row.
- Browsers can read the `players` table but can't write to it. Only the function can, so nobody can submit their own numbers.
- Players can leave at any time, which deletes their row.

A player can only refresh their score once every 10 minutes. Lines come from up to 100 commits in each of a player's 40 most recently pushed repositories, and a single commit counts for at most 2,000 lines.

## 1. Create the Supabase project

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard).
2. Open **Project Settings → API** and copy the **Project URL** and the **anon public** key.

## 2. Create a GitHub OAuth app

1. Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Set **Homepage URL** to your site, for example `https://codewithanshuman.github.io/GitMetrics/`.
3. Set **Authorization callback URL** to `https://<your-project-ref>.supabase.co/auth/v1/callback`.
4. Create it, then generate a client secret.

## 3. Turn on GitHub sign-in in Supabase

1. Open **Authentication → Sign In / Providers → GitHub**, turn it on, and paste the client ID and secret.
2. Open **Authentication → URL Configuration**. Set **Site URL** to your site, and add these **Redirect URLs**:
   - `https://codewithanshuman.github.io/GitMetrics/**`
   - `http://localhost:4173/**` for local development

## 4. Create the table and deploy the function

Install the [Supabase CLI](https://supabase.com/docs/guides/cli), then run these from the repository folder.

```bash
npx supabase login
```

```bash
npx supabase link --project-ref <your-project-ref>
```

```bash
npx supabase db push
```

```bash
npx supabase functions deploy score
```

`db push` creates the `players` table from [supabase/migrations](supabase/migrations), with row-level security on. The function gets its database URL and service key from Supabase automatically, so it needs no secrets of yours.

## 5. Connect the site

For local development, create a `.env.local` file in the repository folder:

```bash
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your anon public key>
```

For GitHub Pages, open the repository's **Settings → Secrets and variables → Actions → Variables** and add `SUPABASE_URL` and `SUPABASE_ANON_KEY` with the same values. The next push builds them in. The anon key is designed to be public, because row-level security protects the data.

## Checking it works

1. Open the site, select **Sign in**, and approve the GitHub prompt.
2. You return to the leaderboard. The first score takes a few seconds while GitHub is read.
3. Your card shows your level and rank, and your row is highlighted in the table.

If scoring fails, open **Edge Functions → score → Logs** in Supabase to see the error.
