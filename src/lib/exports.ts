// Everything a report can be saved as.
import type { Report, Summary } from "../core/types";
import { compact, fmt, saveFile } from "./util";

const slug = (d: Report) => d.m.full_name.replace(/\W+/g, "-");
const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#AAB2C4"];
const realLangs = (S: Summary) => S.rows.filter(g => g.name !== "Other");

export function report(d: Report, S: Summary) {
  const T = S.T, h = S.health;
  return [`# ${d.m.full_name}`, "", S.brief, "", `**${fmt(S.total)} lines** in ${fmt(T.files)} files (${fmt(T.code)} code, ${fmt(T.com)} comments, ${fmt(T.blank)} blank).`, "",
    ...(h ? ["## Health", "", "| Dimension | Score |", "|---|---:|", ...h.dims.filter(x => x.score != null).map(x => `| ${x.label} | ${x.score} |`), ""] : []),
    ...(S.findings.length ? ["## Findings", "", ...S.findings.map(f => `- **${f.title}.** ${f.detail}`), ""] : []),
    "## Languages", "", "| Language | Files | Code | Comments | Blank | Total |", "|---|---:|---:|---:|---:|---:|", ...S.rows.slice(0, 12).map(g => `| ${g.name} | ${fmt(g.files)} | ${fmt(g.code)} | ${fmt(g.com)} | ${fmt(g.blank)} | ${fmt(g.total)} |`)].join("\n");
}

const badge = (label: string, value: string, color: string) => {
  const lw = label.length * 7 + 12, rw = value.length * 8 + 16;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${lw + rw}" height="22" role="img" aria-label="${label}: ${value}"><clipPath id="c"><rect width="${lw + rw}" height="22" rx="4"/></clipPath><g clip-path="url(#c)"><rect width="${lw}" height="22" fill="#10152E"/><rect x="${lw}" width="${rw}" height="22" fill="${color}"/></g><g fill="#fff" font-family="Verdana,sans-serif" font-size="11" text-anchor="middle"><text x="${lw / 2}" y="15">${label}</text><text x="${lw + rw / 2}" y="15">${value}</text></g></svg>`;
};

function readmeCard(d: Report, S: Summary) {
  const h = S.health, W = 495, H = 170, bar = realLangs(S).slice(0, 6), name = d.m.full_name.replace(/[&<>"]/g, ""); let x = 24;
  const rects = bar.map((g, i) => { const w = g.total / S.total * 447, r = `<rect x="${x.toFixed(1)}" y="118" width="${Math.max(w - 2, 2).toFixed(1)}" height="10" fill="${SERIES[i]}"/>`; x += w; return r; }).join("");
  const stat = (k: string, v: string, px: number) => `<text x="${px}" y="82" font-size="22" font-weight="600" fill="#10152E">${v}</text><text x="${px}" y="100" font-size="12" fill="#6B7490">${k}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${name}: ${compact(S.total)} lines"><rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="14" fill="#fff" stroke="#E7EAF2"/><g font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif"><text x="24" y="40" font-size="17" font-weight="600" fill="#10152E">${name}</text>${stat("Lines", compact(S.total), 24)}${stat("Files", compact(S.T.files), 124)}${d.commits != null ? stat("Commits", compact(d.commits), 224) : ""}${h && h.score != null ? `<circle cx="435" cy="60" r="30" fill="#E9EFFE"/><text x="435" y="68" font-size="24" font-weight="700" fill="#3B6FF5" text-anchor="middle">${h.grade}</text>` : ""}${rects}<text x="24" y="150" font-size="11" fill="#6B7490">${bar.slice(0, 3).map(g => g.name).join(" · ")}  ·  GitMetrics</text></g></svg>`;
}

function shareImage(d: Report, S: Summary) {
  const c = document.createElement("canvas"); c.width = 1200; c.height = 630;
  const x = c.getContext("2d")!, F = "'Pixelify Sans',system-ui,sans-serif", ink = "#10152E", mute = "#47506B";
  x.fillStyle = "#DFF4FF"; x.fillRect(0, 0, 1200, 630);
  x.fillStyle = "#2F86D6"; x.font = "500 26px system-ui,sans-serif"; x.fillText("GitMetrics", 70, 86);
  x.fillStyle = ink; x.font = "500 52px " + F; x.fillText(d.m.full_name.slice(0, 36), 70, 156);
  x.font = "500 148px " + F; x.fillText(compact(S.total), 64, 312);
  x.fillStyle = mute; x.font = "400 30px system-ui,sans-serif"; x.fillText(`lines in ${fmt(S.T.files)} files · ${fmt(S.T.code)} code · ${fmt(S.T.com)} comments`, 70, 368);
  if (S.health && S.health.score != null) { x.textAlign = "right"; x.fillStyle = ink; x.font = "500 148px " + F; x.fillText(S.health.grade!, 1130, 312); x.fillStyle = mute; x.font = "400 30px system-ui,sans-serif"; x.fillText(`health ${S.health.score}/100`, 1130, 368); x.textAlign = "left"; }
  const r = realLangs(S).slice(0, 7), rest = S.total - r.reduce((t, g) => t + g.total, 0); let px = 70;
  [...r.map((g, i): [number, string] => [g.total, SERIES[i]]), ...(rest ? [[rest, SERIES[7]] as [number, string]] : [])].forEach(([v, col]) => { const w = v / S.total * 1060; x.fillStyle = col; x.fillRect(px, 418, Math.max(w - 3, 2), 36); px += w; });
  x.font = "400 24px system-ui,sans-serif"; r.slice(0, 5).forEach((g, i) => { x.fillStyle = SERIES[i]; x.fillRect(70 + i * 212, 496, 16, 16); x.fillStyle = ink; x.fillText(g.name.slice(0, 13), 96 + i * 212, 512); });
  const a = document.createElement("a"); a.href = c.toDataURL("image/png"); a.download = slug(d) + "-gitmetrics.png"; a.click();
}

export type ExportKind = "pdf" | "png" | "card" | "md" | "link" | "badge" | "hbadge" | "json" | "csv" | "cloc";
export const EXPORTS: [ExportKind, string][] = [["pdf", "Save as PDF"], ["png", "Share image"], ["card", "README card (SVG)"], ["md", "Copy Markdown report"], ["link", "Copy link"], ["badge", "Lines badge (SVG)"], ["hbadge", "Health badge (SVG)"], ["json", "JSON data"], ["csv", "CSV by language"], ["cloc", "cloc-style CSV"]];

export function exportAs(x: ExportKind, d: Report, S: Summary) {
  const h = S.health, T = S.T;
  switch (x) {
    case "pdf": return print();
    case "png": return shareImage(d, S);
    case "card": return saveFile(slug(d) + "-card.svg", "image/svg+xml", readmeCard(d, S));
    case "md": return navigator.clipboard.writeText(report(d, S));
    case "link": return navigator.clipboard.writeText(location.href);
    case "badge": return saveFile(slug(d) + "-lines.svg", "image/svg+xml", badge("lines of code", compact(S.total), "#3B6FF5"));
    case "hbadge": if (h && h.score != null) saveFile(slug(d) + "-health.svg", "image/svg+xml", badge("health", `${h.grade} ${h.score}`, h.score >= 70 ? "#0A7D52" : h.score >= 40 ? "#A06400" : "#CF2F1E")); return;
    case "json": return saveFile(slug(d) + "-gitmetrics.json", "application/json", JSON.stringify({ repo: d.m.full_name, ref: d.ref, brief: S.brief, totals: { ...T, lines: S.total }, languages: S.rows, health: h, findings: S.findings, effort: S.effort, testShare: S.testShare, duplication: S.dup, busFactor: S.bus ?? null, architecture: { cycles: S.arch.cycles, hubs: S.arch.hubs, external: S.arch.external }, sourceScan: S.flags, debt: S.debt.slice(0, 200), dependencies: d.deps, vulnerabilities: d.vulns || null, folders: S.folders.slice(0, 30) }, null, 2));
    case "cloc": return saveFile(slug(d) + "-cloc.csv", "text/csv", ["files,language,blank,comment,code", ...S.rows.map(g => `${g.files},"${g.name}",${g.blank},${g.com},${g.code}`), `${T.files},SUM,${T.blank},${T.com},${T.code}`].join("\n"));
    case "csv": return saveFile(slug(d) + "-gitmetrics.csv", "text/csv", [["language", "files", "code", "comments", "blank", "total"], ...S.rows.map(g => [g.name, g.files, g.code, g.com, g.blank, g.total])].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n"));
  }
}
