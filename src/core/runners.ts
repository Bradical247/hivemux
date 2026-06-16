// Pluggable headless agent runners. The loop invokes a runner ONE-SHOT per
// iteration. `claude` is built in and verified. Other CLIs (codex, gemini, a
// pi/OpenRouter-backed CLI, …) are added via ~/.hivemux/config.json → "runners":
//
//   { "runners": {
//       "gemini": { "bin": "gemini", "args": ["-p", "{prompt}"], "parse": "text" },
//       "codex":  { "bin": "codex", "args": ["exec", "{prompt}"], "parse": "text" }
//   } }
//
// "{prompt}" and "{resume}" placeholders are substituted. parse "claude-json"
// reads claude's JSON envelope (cost/session/usage); "text" treats stdout as the
// result (cost via the pricing table if the model is known, else unpriced).
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface RunnerAdapter {
  bin: string;
  args: string[]; // may contain "{prompt}"
  resumeArgs?: string[]; // appended (with "{resume}") to continue a session
  parse: "claude-json" | "text";
}

const BUILTIN: Record<string, RunnerAdapter> = {
  claude: {
    bin: "claude",
    args: ["-p", "{prompt}", "--output-format", "json", "--permission-mode", "acceptEdits"],
    resumeArgs: ["--resume", "{resume}"],
    parse: "claude-json",
  },
};

function userRunners(): Record<string, RunnerAdapter> {
  try {
    const cfg = JSON.parse(
      readFileSync(path.join(os.homedir(), ".hivemux", "config.json"), "utf8"),
    );
    return (cfg.runners ?? {}) as Record<string, RunnerAdapter>;
  } catch {
    return {};
  }
}

export function resolveRunner(name: string): RunnerAdapter {
  const all = { ...BUILTIN, ...userRunners() };
  return all[name] ?? { bin: name, args: ["{prompt}"], parse: "text" };
}

export interface TurnOut {
  result: string;
  costUSD: number;
  sessionId?: string;
  model: string;
  inTok: number;
  outTok: number;
}

/** Build argv for a turn, substituting prompt/resume placeholders. */
export function turnArgs(a: RunnerAdapter, prompt: string, resume?: string): string[] {
  const sub = (s: string) => s.replace("{prompt}", prompt).replace("{resume}", resume ?? "");
  const args = a.args.map(sub);
  if (resume && a.resumeArgs) args.push(...a.resumeArgs.map(sub));
  return args;
}

export function parseTurn(a: RunnerAdapter, stdout: string): TurnOut {
  if (a.parse === "claude-json") {
    const j = JSON.parse(stdout) as {
      result?: string;
      total_cost_usd?: number;
      session_id?: string;
      model?: string;
      modelUsage?: Record<string, unknown>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    return {
      result: j.result ?? "",
      costUSD: j.total_cost_usd ?? 0,
      sessionId: j.session_id,
      model: j.model ?? (j.modelUsage ? (Object.keys(j.modelUsage)[0] ?? "") : ""),
      inTok: j.usage?.input_tokens ?? 0,
      outTok: j.usage?.output_tokens ?? 0,
    };
  }
  // "text": stdout is the answer; no cost/session/usage reported by the CLI.
  return { result: stdout, costUSD: 0, model: "", inTok: 0, outTok: 0 };
}
