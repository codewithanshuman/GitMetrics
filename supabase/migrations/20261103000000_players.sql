-- One row per signed-in player. Rows are written only by the score function, which uses the service role.
create table public.players (
  id uuid primary key references auth.users on delete cascade,
  login text not null unique,
  name text,
  avatar text,
  xp integer not null default 0,
  level integer not null default 1,
  title text,
  lines_added bigint not null default 0,
  lines_deleted bigint not null default 0,
  commits integer not null default 0,
  prs integer not null default 0,
  reviews integer not null default 0,
  issues integer not null default 0,
  contributions integer not null default 0,
  week integer not null default 0,
  streak integer not null default 0,
  longest_streak integer not null default 0,
  stars integer not null default 0,
  followers integer not null default 0,
  top_language text,
  languages jsonb not null default '{}'::jsonb,
  badges text[] not null default '{}',
  weekly integer[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.players enable row level security;

create policy "Anyone can read the leaderboard" on public.players
  for select using (true);

-- players can leave the leaderboard, which deletes their row
create policy "Players can remove themselves" on public.players
  for delete using ((select auth.uid()) = id);

create index players_xp_idx on public.players (xp desc);
create index players_lines_idx on public.players (lines_added desc);
create index players_commits_idx on public.players (commits desc);
create index players_week_idx on public.players (week desc);
create index players_streak_idx on public.players (longest_streak desc);
create index players_stars_idx on public.players (stars desc);
create index players_login_lower_idx on public.players (lower(login));
