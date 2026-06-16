// Loop engineering — the differentiator. Drives an agent through
// iterate → verify → fix cycles until a verifier passes or a stop condition
// hits (max iterations / cost cap). Each iteration runs the agent HEADLESS via
// `claude -p --output-format json` in the worktree: one prompt → one completion
// (no interactive REPL, no Stop hook), with exact per-turn cost from the JSON.
// Context carries across iterations via `--resume <session_id>`. The verifier is
// a shell check (exit 0 = pass) or an LLM judge against a rubric.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseTurn, resolveRunner, type TurnOut, turnArgs } from "./runners";
import * as store from "./store";

const pexec = promisify(execFile);

export interface LoopSpec {
  goal: string;
  check?: string; // shell command; exit 0 = pass
  rubric?: string; // LLM-judge criteria (used when no shell check)
  maxIters: number;
  /** headless agent runner; "claude" by default */
  runner?: string;
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
  if (overCap) return { type: "stop", reason: "cost cap reached" };
  if (iter >= maxIters) return { type: "stop", reason: `max iterations (${maxIters}) reached` };
  return {
    type: "retry",
    prompt: `The verification did not pass. Output:\n${verdict.feedback}\n\nFix the cause and try again.`,
  };
}

/** One headless agent turn via the configured runner (claude / codex / gemini / …). */
async function agentTurn(
  runner: string,
  worktree: string,
  prompt: string,
  resumeId?: string,
): Promise<TurnOut> {
  const adapter = resolveRunner(runner);
  const args = turnArgs(adapter, prompt, resumeId);
  // A depleted ANTHROPIC_API_KEY can shadow a working login — drop it for the turn.
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  const { stdout } = await pexec(adapter.bin, args, {
    cwd: worktree,
    env,
    timeout: 300_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return parseTurn(adapter, stdout);
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

/** LLM-judge verifier: ask the runner whether the worktree diff meets the rubric. */
export async function verifyRubric(
  runner: string,
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
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    const { stdout } = await pexec(resolveRunner(runner).bin, ["-p", prompt], {
      cwd: worktree,
      env,
      timeout: 120_000,
    });
    return { pass: /^\s*PASS/i.test(stdout), feedback: stdout.slice(0, 2000) };
  } catch (e) {
    return { pass: false, feedback: `judge unavailable: ${(e as Error).message}` };
  }
}

export interface LoopResult {
  passed: boolean;
  iters: number;
  costUSD: number;
  reason?: string;
}

/** Run the headless verify→fix loop on one agent. `onLog` gets one line per step. */
export async function runLoop(
  name: string,
  spec: LoopSpec,
  onLog: (msg: string) => void = () => {},
): Promise<LoopResult> {
  const a0 = await store.get(name);
  if (!a0) throw new Error(`unknown agent '${name}'`);
  const runner = spec.runner ?? "claude";
  let prompt = spec.goal;
  let resumeId: string | undefined;
  let totalCost = 0;
  let inTok = 0;
  let outTok = 0;
  let model = "";

  const persist = (iter: number, state: "running" | "passed" | "stopped") =>
    store.update(name, {
      loop: {
        goal: spec.goal,
        check: spec.check,
        rubric: spec.rubric,
        maxIters: spec.maxIters,
        iter,
        state,
      },
      usage: { inTok, outTok, cacheRead: 0, cacheWrite: 0 },
      usageModel: model || undefined,
    });

  for (let iter = 1; iter <= spec.maxIters; iter++) {
    await persist(iter, "running");
    onLog(`iter ${iter}/${spec.maxIters}: running agent…`);

    let turn: TurnOut;
    try {
      turn = await agentTurn(runner, a0.worktree, prompt, resumeId);
    } catch (e) {
      await persist(iter, "stopped");
      return {
        passed: false,
        iters: iter,
        costUSD: totalCost,
        reason: `agent failed: ${(e as Error).message}`,
      };
    }
    resumeId = turn.sessionId;
    totalCost += turn.costUSD;
    inTok += turn.inTok;
    outTok += turn.outTok;
    model = turn.model || model;
    onLog(
      `iter ${iter}: agent done ($${turn.costUSD.toFixed(4)}, total $${totalCost.toFixed(4)}); verifying`,
    );

    const verdict = spec.check
      ? await verifyShell(a0.worktree, spec.check)
      : await verifyRubric(runner, a0.worktree, spec.goal, spec.rubric ?? "");
    onLog(`iter ${iter}: ${verdict.pass ? "PASS" : "fail"}`);

    const overCap = a0.costCap != null && totalCost >= a0.costCap;
    const act = decide(iter, spec.maxIters, verdict, overCap);
    if (act.type === "pass") {
      await persist(iter, "passed");
      await store.update(name, { status: "done" });
      return { passed: true, iters: iter, costUSD: totalCost };
    }
    if (act.type === "stop") {
      await persist(iter, "stopped");
      await store.update(name, { status: "error" });
      return { passed: false, iters: iter, costUSD: totalCost, reason: act.reason };
    }
    prompt = act.prompt;
  }
  return {
    passed: false,
    iters: spec.maxIters,
    costUSD: totalCost,
    reason: "max iterations reached",
  };
}
