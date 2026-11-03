// Small shared pieces of the interface.
import type { ReactNode } from "react";
import type { Finding, Flag, LangRow, Level } from "../core/types";
import { fmt, pct } from "../lib/util";
import { SERIES, slot } from "./charts";

export const Logo = ({ size = 24 }: { size?: number }) => (
  <svg className="logomark" height={size} viewBox="330 650 1282 750" fill="currentColor" aria-hidden="true">
    <path d="M342 666C470 660 584 692 584 808C584 905 508 958 388 952C380 1030 410 1108 476 1128C630 1170 700 1010 699 874C698 790 665 708 619 666H867C960 810 975 965 930 1098C1060 1080 1097 960 1097 870C1097 800 1075 720 1035 666H1264C1400 880 1370 1090 1290 1220C1200 1360 1040 1395 897 1377L917 1161L905 1157C800 1320 570 1430 343 1366Z" />
    <ellipse cx="1464" cy="1274" rx="135" ry="115" />
  </svg>
);

export const Tile = ({ k, v, sub, spark }: { k: string; v: ReactNode; sub?: ReactNode; spark?: ReactNode }) => v == null ? null : <div className="card tile"><dt>{k}</dt><dd>{v}</dd>{sub ? <small>{sub}</small> : null}{spark ? <div className="tspark">{spark}</div> : null}</div>;

export const Card = ({ c = "", title, sub, note, id, children }: { c?: string; title?: string; sub?: ReactNode; note?: ReactNode; id?: string; children: ReactNode }) => <section className={`card ${c}`} id={id}>{title && <div className="chead"><h2><span>{title}</span></h2>{sub ? <p className="sub">{sub}</p> : null}</div>}{children}{note ? <p className="note">{note}</p> : null}</section>;

// 1-bit icons in the spirit of early desktop software: # is ink, . is paper
const ICONS: Record<string, string[]> = {
  folder: ["                ", " #####          ", "#.....#         ", "################", "#..............#", "#..............#", "#..............#", "#..............#", "#..............#", "#..............#", "#..............#", "################"],
  chart: ["  ###########   ", "  #.........##  ", "  #.........#.# ", "  #.........####", "  #..........#.#", "  #.......#..#.#", "  #....#..#..#.#", "  #.#..#..#..#.#", "  #.#..#..#..#.#", "  #.#..#..#..#.#", "  #..........#.#", "  ############.#", "   #...........#", "   #############"],
  bomb: ["          # #   ", "         # #    ", "        ##   #  ", "      ###       ", "     #####      ", "   #########    ", "  ###..######   ", " ###.########   ", " ##.#########   ", " ##.#########   ", " #############  ", " #############  ", "  ###########   ", "   #########    ", "     #####      "],
  floppy: ["################", "#..#......#.#..#", "#..#......#.#..#", "#..#......#.#..#", "#..#########...#", "#..............#", "#.############.#", "#.#..........#.#", "#.#.########.#.#", "#.#..........#.#", "#.#.########.#.#", "#.#..........#.#", "################"],
  trash: ["     ######     ", "  ############  ", " #............# ", "  ############  ", "  #..#..#..#.#  ", "  #..#..#..#.#  ", "  #..#..#..#.#  ", "  #..#..#..#.#  ", "  #..#..#..#.#  ", "  #..#..#..#.#  ", "  #..#..#..#.#  ", "  ############  "],
  trophy: ["  ############  ", "###..........###", "#.#..........#.#", "#.#..........#.#", " ##..........## ", "  #..........#  ", "   #........#   ", "    ##....##    ", "      #..#      ", "      #..#      ", "     ######     ", "    #......#    ", "    ########    "],
  flame: ["      #         ", "     ##    #    ", "     #.#  ##    ", "    #..# #.#    ", "   #...##..#    ", "  #.........#   ", "  #....#....#   ", " #....#.#....#  ", " #...#...#...#  ", " #...#...#...#  ", " #....###....#  ", "  #.........#   ", "   #########    "],
  star: ["       ##       ", "      #..#      ", "      #..#      ", "     #....#     ", "######....######", "#..............#", " ##..........## ", "   #........#   ", "   #...##...#   ", "  #..#    #..#  ", "  #.#      #.#  ", " ###        ### "],
  moon: ["     #####      ", "   ##....#      ", "  #....##       ", " #....#         ", " #...#          ", "#....#          ", "#....#          ", "#....#        # ", " #....#      ## ", " #.....######.# ", "  ##.........#  ", "    #########   "],
  sun: ["       #        ", "   #   #   #    ", "    #     #     ", "      ###       ", "     #...#      ", "### #.....# ### ", "     #...#      ", "      ###       ", "    #     #     ", "   #   #   #    ", "       #        "],
  rocket: ["       ##       ", "      #..#      ", "     #....#     ", "     #.##.#     ", "     #.##.#     ", "     #....#     ", "    #......#    ", "   ##......##   ", "  #.#......#.#  ", "  ###.####.###  ", "     #    #     ", "    ##    ##    "],
  lens: ["    #####       ", "  ##.....##     ", " #.........#    ", " #..##.....#    ", "#..#.......#    ", "#..#.......#    ", "#..........#    ", " #.........#    ", " #........##    ", "  ##.....####   ", "    #####  ###  ", "            ### ", "             ###", "              ##"]
};
export function PixelIcon({ name, size = 44 }: { name: string; size?: number }) {
  const rows = ICONS[name], cells: { x: number; y: number; c: string }[] = [];
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch !== " ") cells.push({ x, y, c: ch }); }));
  return <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">{cells.map(p => <rect key={`${p.x}-${p.y}`} x={p.x} y={p.y} width="1.02" height="1.02" fill={p.c === "#" ? "#111" : "#fff"} />)}</svg>;
}

// the pixel dissolve between the sky and the page below
export function PixelEdge() {
  const cells: [number, number][] = [], noise = (n: number) => Math.abs(Math.sin(n * 12.9898) * 43758.5453) % 1;
  for (let x = 0; x < 240; x++) {
    const tall = Math.floor(noise(x) * 3) + Math.floor(noise(x * .13) * 3);
    for (let y = 0; y <= tall; y++) cells.push([x, 7 - y]);
    if (noise(x + 7) > .72) cells.push([x, 7 - tall - 2]);
  }
  return <svg className="edge" width="2880" height="96" viewBox="0 0 240 8" shapeRendering="crispEdges" aria-hidden="true">{cells.map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width="1.02" height="1.02" />)}</svg>;
}

export const Empty = ({ children }: { children: ReactNode }) => <p className="empty">{children}</p>;
export const Path = ({ p, label }: { p: string; label?: string }) => <td className="path" data-file={p}>{label || p}</td>;
export const Num = ({ children }: { children: ReactNode }) => <td className="num">{children}</td>;

const ICON: Record<Level, ReactNode> = {
  good: <svg className="good" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8.500 6.500 12 13 4.500" /></svg>,
  warn: <svg className="warn" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 2 15 14H1zM8 7v3M8 12v.01" /></svg>,
  risk: <svg className="risk" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="8" cy="8" r="6.500" /><path d="M8 4.500v4M8 11.200v.01" /></svg>
};
const LEVEL: Record<Level, string> = { good: "Strength", warn: "Worth a look", risk: "Risk" };
export function FindingRow({ f, onOpen }: { f: Omit<Finding, "tab"> & { tab?: string }; onOpen?: (tab: string) => void }) {
  const body = <>{ICON[f.level]}<div><strong><span className="sr">{LEVEL[f.level]}: </span>{f.title}</strong><span>{f.detail}</span></div></>;
  return f.tab && onOpen ? <button className={`finding ${f.level}`} onClick={() => onOpen(f.tab!)}>{body}</button> : <div className={`finding ${f.level}`} style={{ cursor: "default" }}>{body}</div>;
}

const ranked = (rows: LangRow[]) => rows.filter(g => g.name !== "Other");
export const tintMap = (rows: LangRow[]): Record<string, string> => Object.fromEntries(ranked(rows).map((g, i) => [g.name, i < SERIES - 1 ? `var(--t${i + 1})` : "var(--t8)"]));
export const colorMap = (rows: LangRow[]): Record<string, string> => Object.fromEntries(ranked(rows).map((g, i) => [g.name, i < SERIES - 1 ? slot(i) : "var(--rest)"]));

export function LangStrip({ rows, total }: { rows: LangRow[]; total: number }) {
  const head = ranked(rows).slice(0, SERIES - 1), shown = new Set(head), rt = rows.filter(g => !shown.has(g)).reduce((t, g) => t + g.total, 0);
  return <>
    <div className="strip" role="img" aria-label={"Share of lines by language: " + head.map(g => `${g.name} ${pct(g.total, total)}`).join(", ")}>{head.map((g, i) => <i key={g.name} data-tip={`${g.name}: ${fmt(g.total)} lines`} style={{ flex: g.total, background: slot(i) }} />)}{rt > 0 && <i data-tip={`Other: ${fmt(rt)} lines`} style={{ flex: rt, background: "var(--rest)" }} />}</div>
    <ul className="legend">{head.map((g, i) => <li key={g.name}><em style={{ background: slot(i) }} />{g.name} <small>{pct(g.total, total)}</small></li>)}{rt > 0 && <li><em style={{ background: "var(--rest)" }} />Other <small>{pct(rt, total)}</small></li>}</ul>
  </>;
}

export const SevPill = ({ s }: { s: Flag["severity"] }) => <span className={`pill ${s}`}>{s[0] + s.slice(1).toLowerCase()}</span>;
