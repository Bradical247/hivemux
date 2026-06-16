// Loop engineering — the differentiator. Drives an agent through
// iterate → verify → fix cycles until a verifier passes or a stop condition
// hits (max iterations / cost cap / context cap). This turns hivemux from
// "watch agents" into "agents that finish the job unattended, gated by a real
// check", headless on a server with cost ceilings.
//
// Turn completion is signalled by the agent's own Stop hook calling
// `hivemux notify -s done` (auto-installed for looped agents). The verifier is
// either a shell check (exit 0 = pass) or an LLM judge against a rubric.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as store from "./store";
import { sendKeys, sessionExists } from "./tmux";
import { agentUsage } from "./usage";

const pexec = promisify(execFile);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface LoopSpec {
  goal: string;
  check?: string; // shell command; exit 0 = pass
  rubric?: string; // LLM-judge criteria (used when no shell check)
  maxIters: number;
  turnTimeoutMs?: number;
}

export interface Verdict {
  pass: boolean;
  feedback: string;
}

export type LoopAction =
  | { type: "pass" }
  | { type: "retry"; prompt: string }
  | { type: "stop"; reason: string };

/** Pure decision: given an iteration's verdict + cap state, what happens next. */
export function decide(
  iter: number,
  maxIters: number,
  verdict: Verdict,
  overCap: boolean,
): LoopAction {
  if (verdict.pass) return { type: "pass" };
  if (overCap) return { type: "stop", reason: "cost/context cap reached" };
  if (iter >= maxIters) return { type: "stop", reason: `max iterations (${maxIters}) reached` };
  return {
    type: "retry",
    prompt: `The verification did not pass yet. Output:\n${verdict.feedback}\n\nFix the cause and continue. When done, stop and let the check re-run.`,
  };
}

/** Shell verifier: run `cmd` in the worktree; exit 0 = pass. */
export async function verifyShell(worktree: string, cmd: string): Promise<Verdict> {
  try {
    const { stdout, stderr } = await pexec("bash", ["-lc", cmd], { cwd: worktree });
    return { pass: true, feedback: `${stdout}${stderr}`.slice(-2000) };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const out = `${err.stdout ?? ""}${err.stderr ?? ""}`.trim();
    return { pass: false, feedback: (out || err.message || "check failed").slice(-2000) };
  }
}

/** LLM-judge verifier: ask `claude -p` whether the worktree diff meets the rubric. */
export async function verifyRubric(
  worktree: string,
  goal: string,
  rubric: string,
): Promise<Verdict> {
  let diff = "";
  try {
    diff = (await pexec("git", ["-C", worktree, "diff", "HEAD"])).stdout;
  } catch {
    /* no diff */
  }
  const prompt = `You are a strict grader. Reply with PASS or FAIL on the first line, then one sentence why.\n\nGOAL:\n${goal}\n\nRUBRIC:\n${rubric}\n\nAGENT'S DIFF (truncated):\n${diff.slice(0, 8000)}`;
  try {
    const { stdout } = await pexec("claude", ["-p", prompt], { cwd: worktree, timeout: 120_000 });
    return { pass: /^\s*PASS/i.test(stdout), feedback: stdout.slice(0, 2000) };
  } catch (e) {
    return { pass: false, feedback: `judge unavailable: ${(e as Error).message}` };
  }
}

async function waitTurn(name: string, timeoutMs: number): Promise<boolean> {
  await store.update(name, { status: "running" });
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const a = await store.get(name);
    if (!a) return false;
    if (!(await sessionExists(a.session))) return false;
    if (a.status === "done" || a.status === "waiting" || a.status === "error") return true;
    await sleep(1500);
  }
  return false;
}

export interface LoopResult {
  passed: boolean;
  iters: number;
  reason?: string;
}

/** Run the loop on one agent. `onLog` receives one line per step. */
export async function runLoop(
  name: string,
  spec: LoopSpec,
  onLog: (msg: string) => void = () => {},
): Promise<LoopResult> {
  const a0 = await store.get(name);
  if (!a0) throw new Error(`unknown agent '${name}'`);
  let prompt = spec.goal;

  for (let iter = 1; iter <= spec.maxIters; iter++) {
    await store.update(name, {
      loop: {
        goal: spec.goal,
        check: spec.check,
        rubric: spec.rubric,
        maxIters: spec.maxIters,
        iter,
        state: "running",
      },
    });
    onLog(`iter ${iter}/${spec.maxIters}: sending prompt`);
    await sendKeys(a0.session, prompt);

    if (!(await waitTurn(name, spec.turnTimeoutMs ?? 600_000))) {
      await store.update(name, { loop: { ...specState(spec, iter), state: "stopped" } });
      return { passed: false, iters: iter, reason: "agent turn timed out or session ended" };
    }

    const verdict = spec.check
      ? await verifyShell(a0.worktree, spec.check)
      : await verifyRubric(a0.worktree, spec.goal, spec.rubric ?? "");
    onLog(`iter ${iter}: ${verdict.pass ? "PASS" : "fail"}`);

    const cur = await store.get(name);
    const u = cur ? await agentUsage(cur) : null;
    const overCap =
      (cur?.costCap != null && u?.costUSD != null && u.costUSD >= cur.costCap) ||
      (cur?.ctxCap != null && u?.ctxPct != null && u.ctxPct >= cur.ctxCap);

    const act = decide(iter, spec.maxIters, verdict, Boolean(overCap));
    if (act.type === "pass") {
      await store.update(name, {
        status: "done",
        loop: { ...specState(spec, iter), state: "passed" },
      });
      return { passed: true, iters: iter };
    }
    if (act.type === "stop") {
      await store.update(name, {
        status: "error",
        loop: { ...specState(spec, iter), state: "stopped" },
      });
      return { passed: false, iters: iter, reason: act.reason };
    }
    prompt = act.prompt;
  }
  return { passed: false, iters: spec.maxIters, reason: "max iterations reached" };
}

function specState(spec: LoopSpec, iter: number) {
  return { goal: spec.goal, check: spec.check, rubric: spec.rubric, maxIters: spec.maxIters, iter };
}
