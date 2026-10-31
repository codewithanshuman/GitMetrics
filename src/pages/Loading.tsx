import { useCallback, useMemo, useState } from "react";
import { motion } from "motion/react";
import { useApp } from "../app/App";

export interface StepState { state: "run" | "done"; note?: string; frac?: number }
export function useSteps() {
  const [steps, setSteps] = useState<Record<string, StepState>>({});
  const step = useCallback((id: string, state: "run" | "done", note?: string, frac?: number) => setSteps(s => ({ ...s, [id]: { state, note, frac } })), []);
  const reset = useCallback(() => setSteps({}), []);
  return useMemo(() => ({ steps, step, reset }), [steps, step, reset]);
}

export function Loading({ title, steps, state, onCancel }: { title: string; steps: [string, string][]; state: Record<string, StepState>; onCancel: () => void }) {
  const progress = steps.reduce((t, [id]) => t + (state[id]?.state === "done" ? 1 : state[id] ? state[id].frac || .15 : 0), 0) / steps.length;
  return <div className="load">
    <img className="mascot run" src={import.meta.env.BASE_URL + "octocat.png"} alt="" />
    <h2>{title}</h2>
    <div className="pbar"><motion.i animate={{ width: `${progress * 100}%` }} transition={{ duration: .25 }} /></div>
    <ol className="steps">{steps.map(([id, l]) => <li key={id} className={state[id]?.state}><i /><span>{l}</span><small>{state[id]?.note}</small></li>)}</ol>
    <button className="btn" onClick={onCancel}>Cancel</button>
  </div>;
}

export function Failure({ msg, limited }: { msg: string; limited?: boolean }) {
  const { home, openSettings, token } = useApp();
  return <div className="load"><h2>That didn’t work</h2><div className="alert"><p>{msg}</p></div><div className="headact">{limited && !token && <button className="btn pri" onClick={openSettings}>Add a token</button>}<button className="btn" onClick={home}>Back to start</button></div></div>;
}
