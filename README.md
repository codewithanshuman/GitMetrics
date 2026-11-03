# GitMetrics

Repository intelligence that runs in your browser. Give it a GitHub repo, a pull request, a user, or a local folder, and it reports what's inside and how healthy it is. Analysis needs no server and no sign-in. An optional global leaderboard lets developers sign in with GitHub and compete.

Built with React, TypeScript and Vite. Counting runs in a Web Worker, so large repositories don't freeze the page.

## What it does

- **The brief:** a plain-English summary of the repository, with a projection for the next quarter.
- **Line counts:** code, comments and blanks across 50+ languages, read from the source.
- **Health score:** an A–F grade from six dimensions. Dimensions without data drop out instead of scoring zero, and every input is shown.
- **Architecture map:** an interactive graph of internal imports, with circular dependencies, hub files and top external modules.
- **Source scan:** finds likely secrets, risky calls and TODO debt. Secret values are masked everywhere in the app.
- **Vulnerability scan:** checks dependency versions against [OSV.dev](https://osv.dev), preferring exact versions from lock files.
- **Dependency freshness:** compares manifests with the npm and PyPI registries.
- **Deep scan:** churn hotspots, change coupling and folder ownership from recent commits.
- **File inspector:** select any file to see its source, imports and importers.
- **File queries:** filter with `lang:python lines:>200 test:false src/`. Fields are `lang`, `path`, `lines`, `code`, `branches`, `todo`, `imports` and `test`.
- **Pull request review:** paste a PR link for a risk score and review notes.
- **Flow and people:** merge and close times, backlog age, bus factor and per-author history.
- **Compare and profiles:** put up to four repos side by side, or view a whole user or organization.
- **Repository leaderboard:** every report ranks its authors by XP, lines written, commits, recent activity and net lines, with a podium, levels and badges.
- **Global leaderboard:** sign in with GitHub to get a level, XP and 13 badges from a year of real activity, and rank against everyone by XP, lines written, commits, this week, streak or stars. Scores are computed on a server, so they can't be faked. See [LEADERBOARD.md](LEADERBOARD.md) to set it up.
- **Player cards:** each player has a page with badges, head-to-head comparison and a shareable SVG card.
- **Watchlist:** follow repositories and see their health over time. This stays in your browser.
- **Exports:** PDF, share image, README card, Markdown, JSON, CSV, cloc-style CSV and SVG badges.

Press `Ctrl K` for the command palette, `/` to search and the number keys to switch sections. Reports have shareable URLs, such as `#pallets/flask~risk`.

## Run it

Needs Node 20 or later.

```bash
npm install
```

```bash
npm run dev
```

Then open http://localhost:4173. To publish, turn on GitHub Pages with **GitHub Actions** as the source, and every push to `main` deploys through [.github/workflows/pages.yml](.github/workflows/pages.yml).

### API limits

Without a token, GitHub allows 60 API requests an hour, and one report uses about 20. Reading files from public repos doesn't count against that limit. Add a token in Settings for 5,000 requests an hour and for private repositories. The token goes only to GitHub, and stays in your browser only if you tick the box.

## Command line

```bash
npm run cli -- . --markdown
```

```bash
npm run cli -- pallets/flask --json
```

Options: `--json`, `--markdown`, `--csv`, `--diff <folder>` and `--all`.

## Pull request comments

Copy [github-action/tally-pr.yml](github-action/tally-pr.yml) to `.github/workflows/` to post the line-count change on every pull request.

## How accuracy works

- Counting is line-based and follows each language's comment syntax. It doesn't fully parse code.
- The architecture map reads import statements. It can't see imports built at runtime, or path aliases such as `@/components`.
- The source scan uses patterns, so it can miss things and can flag false positives.
- The health score, risk scores, forecast and COCOMO cost are heuristics for guiding a review, not verdicts.
- Flow figures use GitHub's 100 most recently updated items, so they're a sample of recent work.
- Scanning a version taken from a range such as `^1.2.3` uses the lowest allowed version. Commit a lock file for exact results.

## Development

```bash
npm test
```

```bash
npm run build
```

| Path | Purpose |
|---|---|
| `src/core/` | Framework-free logic: counting, scanning, graph, metrics and API access |
| `src/worker/` | Background counting |
| `src/app/` | App shell, routing and report loading |
| `src/pages/` | Screens and report sections |
| `src/ui/` | Charts and shared components |
| `cli/` | Command line tool, which shares `src/core` |
| `supabase/` | Leaderboard database schema, scoring function and shared scoring rules |
| `tests/` | Vitest suite |
