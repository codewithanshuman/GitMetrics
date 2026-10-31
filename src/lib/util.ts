// Formatting, browser storage and the count worker bridge.
import type { CountResult } from "../core/types";
import type { CountJob } from "../worker/count.worker";

const nf = new Intl.NumberFormat("en-US"), cf = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
export const fmt = (n: number | null | undefined) => n == null ? "–" : nf.format(n);
export const compact = (n: number | null | undefined) => n == null ? "–" : cf.format(n);
export const pct = (a: number, b: number, d = 1) => b ? (a / b * 100).toFixed(d) + "%" : "–";
export const date = (d: string | number | Date) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
export const monthYear = (d: string | number | Date) => new Date(d).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });

export const store = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage may be blocked */ } },
  del(k: string) { try { localStorage.removeItem(k); } catch { /* storage may be blocked */ } }
};

export function runCount(job: CountJob, onProgress: (done: number, all: number) => void, signal?: AbortSignal) {
  return new Promise<CountResult>((ok, no) => {
    const w = new Worker(new URL("../worker/count.worker.ts", import.meta.url), { type: "module" });
    const end = () => w.terminate();
    signal?.addEventListener("abort", () => { end(); no(new DOMException("Cancelled", "AbortError")); });
    w.onmessage = e => {
      const m = e.data;
      if (m.type === "progress") onProgress(m.done, m.all);
      if (m.type === "done") { end(); ok(m.result); }
      if (m.type === "error") { end(); no(new Error(m.message)); }
    };
    w.onerror = e => { end(); no(new Error(e.message || "The background counter failed.")); };
    w.postMessage(job);
  });
}

export function saveFile(name: string, type: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
