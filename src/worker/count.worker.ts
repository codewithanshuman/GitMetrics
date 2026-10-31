// Counts in a background thread, so large repositories never freeze the page.
import JSZip from "jszip";
import { countEntries } from "../core/engine";
import { remoteEntries, type RemoteSpec } from "../core/github";
import type { Entry } from "../core/types";

export type CountJob =
  | { kind: "remote"; spec: RemoteSpec }
  | { kind: "zip"; file: File; vendor: boolean }
  | { kind: "files"; files: { path: string; file: File }[]; vendor: boolean };

const stripTop = (l: Entry[]): Entry[] => {
  const f = l[0] ? l[0][0].split("/")[0] : "";
  return l.length && l.every(x => x[0].includes("/") && x[0].split("/")[0] === f) ? l.map(([p, v]) => [p.slice(f.length + 1), v]) : l;
};

self.onmessage = async (e: MessageEvent<CountJob>) => {
  const job = e.data;
  try {
    let entries: Entry[];
    if (job.kind === "remote") entries = remoteEntries(job.spec);
    else if (job.kind === "zip") {
      const zip = await JSZip.loadAsync(job.file), out: Entry[] = [];
      zip.forEach((p, ent) => { if (!ent.dir) out.push([p, { size: 0, async: () => ent.async("uint8array") }]); });
      entries = stripTop(out);
    } else entries = stripTop(job.files.map(({ path, file }) => [path, { size: file.size, async: async () => new Uint8Array(await file.arrayBuffer()) }]));
    const vendor = job.kind === "remote" ? job.spec.vendor : job.vendor;
    const result = await countEntries(entries, { vendor, concurrency: job.kind === "remote" ? (job.spec.isPrivate ? 6 : 16) : 8, onProgress: (done, all) => self.postMessage({ type: "progress", done, all }) });
    self.postMessage({ type: "done", result });
  } catch (err) {
    self.postMessage({ type: "error", message: (err as Error).message || "Those files couldn’t be read." });
  }
};
