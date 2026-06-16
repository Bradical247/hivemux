// Loop engineering — the differentiator. Drives an agent through
// iterate → verify → fix cycles until a verifier passes or a stop condition
// hits (max iterations / cost cap). Each iteration runs the agent HEADLESS via
// `claude -p --output-format json` in the worktree: one prompt → one completion
// (no interactive REPL, no Stop hook), with exact per-turn cost from the JSON.
// Context carries across iterations via `--resume <session_id>`. The verifier is
// a shell check (exit 0 = pass) or an LLM judge against a rubric.
import { execFile, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { loadPolicy } from "./policy";
import { applyPonytail } from "./ponytail";
import { parseTurn, resolveRunner, type TurnOut, turnArgs } from "./runners";
import { type SandboxMode, wrap } from "./sandbox";
import * as store from "./store";
import { sendKeys } from "./tmux";

const pexec = promisify(execFile);

// Registry of in-flight loops in THIS process (for stop/list). A loop checks its
// token between iterations, so `stopLoop` cancels cleanly at the next boundary.
const RUNNING = new Map<string, { cancel: boolean }>();

export function stopLoop(name: string): boolean {
  const t = RUNNING.get(name);
  if (!t) return false;
  t.cancel = true;
  return true;
}
export function runningLoops(): string[] {
  return [...RUNNING.keys()];
}

export function loopHistoryFile(name: string): string {
  return path.join(os.homedir(), ".hivemux", "loops", `${name}.jsonl`);
}
/** Live transcript the agent streams to in watch mode; the tile tails it. */
export function loopLiveFile(name: string): string {
  return path.join(os.homedir(), ".hivemux", "loops", `${name}.live`);
}
async function appendHistory(name: string, record: Record<string, unknown>): Promise<void> {
  try {
    const f = loopHistoryFile(name);
    await mkdir(path.dirname(f), { recursive: true });
    await appendFile(f, `${JSON.stringify({ ts: new Date().toISOString(), ...record })}\n`);
  } catch {
    /* history is best-effort */
  }
}

export interface LoopSpec {
  goal: string;
  check?: string; // shell command; exit 0 = pass
  rubric?: string; // LLM-judge criteria (used when no shell check)
  maxIters: number;
  /** headless agent runner; "claude" by default */
  runner?: string;
  /** prepend the Ponytail "lazy senior dev" directive to the agent's prompt */
  ponytail?: boolean;
  /** OS sandbox override (else the policy default); "auto" | "on" | "off" */
  sandbox?: SandboxMode;
  /** allow network inside the sandbox (else the policy default) */
  network?: boolean;
  /** stream the agent's output (incl. thinking) into its tmux pane to watch live */
  watch?: boolean;
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

/** Switch a claude argv to realtime streaming so we can mirror its thinking. */
function streamArgs(args: string[]): string[] {
  const a = [...args];
  const i = a.indexOf("--output-format");
  if (i >= 0 && a[i + 1]) a[i + 1] = "stream-json";
  else a.push("--output-format", "stream-json");
  if (!a.includes("--verbose")) a.push("--verbose");
  if (!a.includes("--include-partial-messages")) a.push("--include-partial-messages");
  return a;
}

/** Run a turn streaming, mirroring text + thinking to `liveFile` as it arrives. */
function streamTurn(
  bin: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv },
  liveFile: string,
  claudeJson: boolean,
): Promise<TurnOut> {
  return new Promise((resolve, reject) => {
    const ch = spawn(bin, args, { cwd: opts.cwd, env: opts.env });
    const out = createWriteStream(liveFile, { flags: "a" });
    let buf = "";
    let result = "";
    let costUSD = 0;
    let sessionId: string | undefined;
    let model = "";
    let inTok = 0;
    let outTok = 0;
    const killT = setTimeout(() => {
      try {
        ch.kill("SIGKILL");
      } catch {}
    }, 300_000);
    ch.stdout.on("data", (d: Buffer) => {
      if (!claudeJson) {
        out.write(d);
        result += d.toString();
        return;
      }
      buf += d.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? ""; // keep the trailing partial line for next chunk
      for (const line of lines) {
        if (!line.trim()) continue;
        let ev: Record<string, unknown>;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        const t = ev.type;
        if (t === "stream_event") {
          const e = ev.event as { type?: string; delta?: Record<string, string> } | undefined;
          if (e?.type === "content_block_delta") {
            const dl = e.delta ?? {};
            if (dl.type === "text_delta" && dl.text) out.write(dl.text);
            else if (dl.type === "thinking_delta" && dl.thinking) out.write(dl.thinking);
          }
        } else if (t === "assistant") {
          const content = (ev.message as { content?: Array<Record<string, unknown>> })?.content;
          if (Array.isArray(content))
            for (const b of content)
              if (b.type === "tool_use") out.write(`\n[tool: ${(b.name as string) ?? "?"}]\n`);
        } else if (t === "result") {
          result = (ev.result as string) ?? result;
          costUSD = (ev.total_cost_usd as number) ?? costUSD;
          sessionId = (ev.session_id as string) ?? sessionId;
          const mu = ev.modelUsage as Record<string, unknown> | undefined;
          model = (ev.model as string) ?? (mu ? (Object.keys(mu)[0] ?? "") : model);
          const u = ev.usage as { input_tokens?: number; output_tokens?: number } | undefined;
          inTok = u?.input_tokens ?? inTok;
          outTok = u?.output_tokens ?? outTok;
        }
      }
    });
    ch.on("error", (e) => {
      clearTimeout(killT);
      out.end();
      reject(e);
    });
    ch.on("close", () => {
      clearTimeout(killT);
      out.write(`\n[turn done $${costUSD.toFixed(4)}]\n`);
      out.end();
      resolve({ result, costUSD, sessionId, model, inTok, outTok });
    });
  });
}

/** One headless agent turn via the configured runner (claude / codex / gemini / …). */
async function agentTurn(
  runner: string,
  worktree: string,
  prompt: string,
  resumeId?: string,
  sandbox?: { mode: SandboxMode; network: boolean; extraBinds: string[] },
  liveFile?: string,
): Promise<TurnOut> {
  const adapter = resolveRunner(runner);
  const streaming = Boolean(liveFile);
  const claudeJson = adapter.parse === "claude-json";
  // watch mode: switch claude to streaming so its thinking can be mirrored live.
  const args =
    streaming && claudeJson
      ? streamArgs(turnArgs(adapter, prompt, resumeId))
      : turnArgs(adapter, prompt, resumeId);
  // Confine the agent to its worktree (OS sandbox) when enabled/available.
  const w = sandbox
    ? wrap(adapter.bin, args, {
        worktree,
        network: sandbox.network,
        mode: sandbox.mode,
        extraBinds: sandbox.extraBinds,
      })
    : { bin: adapter.bin, args };
  // A depleted ANTHROPIC_API_KEY can shadow a working login — drop it for the turn.
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  if (streaming && liveFile)
    return streamTurn(w.bin, w.args, { cwd: worktree, env }, liveFile, claudeJson);
  const { stdout } = await pexec(w.bin, w.args, {
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
  const policy = loadPolicy();
  const sandbox = {
    mode: spec.sandbox ?? policy.sandbox,
    network: spec.network ?? policy.network,
    extraBinds: [path.join(a0.repo, ".git")], // git worktree metadata lives here
  };
  // Effective cost ceiling: tighter of the agent's cap and the policy ceiling.
  const costCap = [a0.costCap, policy.maxCostUSD]
    .filter((n): n is number => n != null)
    .sort((x, y) => x - y)[0];
  const token = { cancel: false };
  RUNNING.set(name, token);
  await appendHistory(name, { event: "start", goal: spec.goal, maxIters: spec.maxIters });
  // watch mode: stream the agent's output to a live file and tail it in the
  // agent's tmux pane, so the grid tile shows it working (incl. thinking).
  let liveFile: string | undefined;
  if (spec.watch) {
    liveFile = loopLiveFile(name);
    try {
      await mkdir(path.dirname(liveFile), { recursive: true });
      await writeFile(liveFile, `hivemux watch · ${name}\ngoal: ${spec.goal}\n\n`);
      await sendKeys(a0.session, `clear; tail -n +1 -f '${liveFile}'`);
    } catch {
      /* best-effort: if the pane is busy, the loop still runs headless */
    }
  }
  // Ponytail rides in once on the opening prompt; --resume carries it forward.
  let prompt = applyPonytail(spec.goal, spec.ponytail);
  let resumeId: string | undefined;
  let totalCost = 0;
  let inTok = 0;
  let outTok = 0;
  let model = "";
  const finish = async (r: LoopResult): Promise<LoopResult> => {
    RUNNING.delete(name);
    await appendHistory(name, { event: "end", ...r });
    return r;
  };

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
    if (token.cancel) {
      await persist(iter, "stopped");
      await store.update(name, { status: "error" });
      return finish({ passed: false, iters: iter - 1, costUSD: totalCost, reason: "cancelled" });
    }
    await persist(iter, "running");
    onLog(`iter ${iter}/${spec.maxIters}: running agent…`);

    let turn: TurnOut;
    try {
      turn = await agentTurn(runner, a0.worktree, prompt, resumeId, sandbox, liveFile);
    } catch (e) {
      await persist(iter, "stopped");
      return finish({
        passed: false,
        iters: iter,
        costUSD: totalCost,
        reason: `agent failed: ${(e as Error).message}`,
      });
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
    await appendHistory(name, { iter, pass: verdict.pass, costUSD: totalCost });

    const overCap = costCap != null && totalCost >= costCap;
    const act = decide(iter, spec.maxIters, verdict, overCap);
    if (act.type === "pass") {
      await persist(iter, "passed");
      await store.update(name, { status: "done" });
      return finish({ passed: true, iters: iter, costUSD: totalCost });
    }
    if (act.type === "stop") {
      await persist(iter, "stopped");
      await store.update(name, { status: "error" });
      return finish({ passed: false, iters: iter, costUSD: totalCost, reason: act.reason });
    }
    prompt = act.prompt;
  }
  return finish({
    passed: false,
    iters: spec.maxIters,
    costUSD: totalCost,
    reason: "max iterations reached",
  });
}
