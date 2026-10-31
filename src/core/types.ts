// Shared data shapes. GitHub types list only the fields GitMetrics reads.

export type LangDef = [name: string, lineComment: string, ...blocks: string[]];
export interface FileEntry { size: number; async(type?: string): Promise<Uint8Array> }
export type Entry = [path: string, entry: FileEntry];

export interface LangTotals { name: string; files: number; code: number; com: number; blank: number }
export interface LangRow extends LangTotals { total: number }
export interface FileStat { path: string; lang: string; lines: number; code: number; com: number; test: boolean; br: number; todo: number; imports: string[] }
export interface DepManifest { file: string; ecosystem: string; kind: string; exact: boolean; names: string[]; vers: Record<string, string> }
export interface DebtNote { path: string; line: number; tag: string; text: string }
export type Severity = "CRITICAL" | "HIGH" | "MODERATE" | "LOW" | "UNRATED";
export interface Flag { kind: "secret" | "code"; name: string; severity: Severity; path: string; line: number; preview: string }

export interface CountResult {
  langs: Record<string, LangTotals>; files: FileStat[]; deps: DepManifest[]; debt: DebtNote[]; flags: Flag[];
  skipped: number; binary: number; failed: number; dup: number | null;
}

export interface GhUser { login: string; avatar_url: string; html_url: string }
export interface GhRepo {
  full_name: string; html_url: string; description?: string | null; owner?: GhUser; default_branch?: string; private?: boolean; fork?: boolean; archived?: boolean;
  language?: string | null; license?: { spdx_id: string } | null; created_at?: string; pushed_at?: string; size?: number;
  stargazers_count?: number; forks_count?: number; open_issues_count?: number; topics?: string[]; name?: string;
}
export interface GhContributor extends Partial<GhUser> { contributions: number }
export interface GhRelease { tag_name: string; published_at: string | null; created_at: string; prerelease: boolean }
export interface WeekActivity { week: number; total: number; days: number[] | null }
export interface AuthorStat { total: number; author: GhUser | null; weeks: { w: number; a: number; d: number; c: number }[] }
export type CodeFreq = [week: number, added: number, deleted: number];
export type Punch = [day: number, hour: number, commits: number];
export interface Community { health_percentage: number }
export interface Issue { number: number; title: string; pr: boolean; created: string; updated: string; closed: string | null; merged: string | null; labels: string[] }
export interface VulnRow { id: string; alias: string; summary: string; severity: Severity; rank: number; fixed: string; pkg: ScanTarget }
export interface ScanTarget { ecosystem: string; name: string; version: string; exact: boolean }
export interface VulnReport { checked: number; approx: number; total: number; affected: number; rows: VulnRow[] }
export interface OutdatedRow { name: string; version: string; ecosystem: string; latest: string; gap: number }
export interface StarHistory { pts: { at: number; stars: number }[]; capped: boolean }
export interface DeepCommit { sha?: string; author: string | null | undefined; at?: string; files: { path: string; add: number; del: number }[] }

export interface Report extends CountResult {
  o: string; n: string; m: GhRepo; ref: string; vendor: boolean; key?: string; wantRef?: string; local?: boolean;
  truncated?: boolean; capped?: boolean; commits?: number | null; contribs?: number | null; prs?: number | null; releases?: number | null;
  act?: WeekActivity[] | null; growth?: CodeFreq[] | null; punch?: Punch[] | null; authors?: AuthorStat[] | null; comm?: Community | null;
  who: GhContributor[]; rel: GhRelease[]; issues?: Issue[] | null; missing?: boolean; pending?: string[];
  deep?: DeepStats; vulns?: VulnReport; outdated?: { checked: number; rows: OutdatedRow[] }; starHist?: StarHistory;
  history?: Snapshot | null; since?: string; syncing?: boolean; watched?: boolean; layout?: [number, number][];
}
export interface Snapshot { lines: number; stars?: number; commits?: number | null; health?: number | null; at: number; series?: number[] }

export interface HotFile { path: string; commits: number; add: number; del: number; authors: number; br: number; lines: number; lang: string; risk: number }
export interface DeepStats { sample: number; hot: HotFile[]; coupling: { a: string; b: string; n: number; ratio: number }[]; ownership: { dir: string; owner: string; share: number; touches: number; authors: number }[] }

export interface GraphNode { path: string; lines: number; in: number; out: number; cycle: boolean; group: string }
export interface GraphEdge { a: number; b: number; cycle: boolean }
export interface Hub { path: string; in: number; out: number; lines: number }
export interface Graph {
  files: number; linked: number; edges: GraphEdge[]; edgeCount: number; nodes: GraphNode[]; hubs: Hub[]; heavy: Hub[]; shown: number;
  neighbors: Record<string, string[]>; cycles: string[][]; cycleCount: number; external: { label: string; value: number }[];
}

export type Level = "good" | "warn" | "risk";
export interface Finding { level: Level; title: string; detail: string; tab: string }
export interface Factor { label: string; value: string; score: number }
export interface Dimension { key: string; label: string; desc: string; score: number | null; factors: Factor[] }
export interface Health { score: number | null; grade: string | null; dims: Dimension[] }
export interface LabelValue { label: string; value: number }
export interface FlowStats {
  issueMedian: number | null; issueP90: number | null; prMedian: number | null; prP90: number | null; stale: number; openSample: number; closedSample: number;
  mergedSample: number; unmerged: number; ages: LabelValue[]; months: { month: string; issues: number; prs: number }[]; labels: LabelValue[];
}
export interface Person { login: string; avatar: string; url: string; total: number; add: number; del: number; recent: number; year: number; first: number | null; last: number | null; spark: number[] }
export interface PeopleStats { list: Person[]; active90: number; active365: number; recentTotal: number; topShare: number | null; newcomers: LabelValue[] }
export interface ReleaseStats { list: { tag: string; at: Date; pre: boolean }[]; cadence: number | null; since: number | null }
export interface Forecast { slope: number; next: number; last: number; change: number | null; trend: "steady" | "rising" | "falling" }

export interface Summary {
  rows: LangRow[]; T: { files: number; code: number; com: number; blank: number }; total: number; dup: number | null; testShare: number | null; tl: number; pl: number; hugeShare: number | null;
  folders: { name: string; files: number; lines: number }[]; effort: { personMonths: number; months: number; people: number; cost: number }; biggest?: FileStat; hotspots: FileStat[];
  arch: Graph; flags: Flag[]; debt: DebtNote[]; debtTotal: number; debtTags: LabelValue[]; brief: string; findings: Finding[]; health: Health | null; local?: boolean;
  flow?: FlowStats | null; people?: PeopleStats | null; releases?: ReleaseStats; bus?: number | null; yearCommits?: number | null; activeWeeks?: number | null; forecast?: Forecast | null;
}

export interface PrFile { filename: string; additions: number; deletions: number; status?: string }
export interface PrInfo {
  title: string; number: number; state: string; draft?: boolean; html_url: string; user: GhUser; head: { ref: string }; base: { ref: string }; created_at: string; merged_at: string | null; closed_at: string | null;
  additions: number; deletions: number; changed_files: number; comments: number; review_comments: number; mergeable_state?: string;
}
export interface PrReview { user: { login: string } | null; state: string }
export interface PrStats { changed: number; size: string; score: number; level: "Low" | "Medium" | "High"; approved: number; blocked: number; tests: number; sensitive: number; notes: Omit<Finding, "tab">[]; age: number; langs: LabelValue[] }
export interface ProfileData { info: { login: string; name?: string | null; bio?: string | null; avatar_url: string; html_url: string; location?: string | null; type: string; created_at: string; public_repos: number; followers: number }; repos: (GhRepo & { name: string; created_at: string; pushed_at: string })[] }
