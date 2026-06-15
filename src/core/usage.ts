// Per-agent token/cost/context observability. amux drives agents through tmux,
// so it has no direct API usage — it reconstructs usage from two sources:
//   1. transcript  — parse the agent CLI's own session log (zero setup).
//                    Claude Code writes JSONL under ~/.claude/projects/<slug>/.
//   2. push        — the agent self-reports via `amux report-usage` (a hook),
//                    stored on the agent record. Agent-agnostic, any LLM.
// Transcript wins when available; push is the fallback. Cost/context come from
// the pricing table (see pricing.ts).
import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { costUSD, priceFor, type RawUsage } from "./pricing";
import type { Agent, Usage } from "./types";

const ZERO: RawUsage = { inTok: 0, outTok: 0, cacheRead: 0, cacheWrite: 0 };

interface TranscriptLine {
  cwd?: string;
  usage?: AnthropicUsage;
  message?: { model?: string; usage?: AnthropicUsage };
}
interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

/** Best-effort parse of Claude Code's JSONL transcript for a worktree cwd. */
async function claudeTranscript(
  worktree: string,
): Promise<{ raw: RawUsage; model: string; ctxTokens: number } | null> {
  try {
    const root = path.join(os.homedir(), ".claude", "projects");
    for (const slug of await readdir(root)) {
      const dir = path.join(root, slug);
      let files: string[];
      try {
        files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"));
      } catch {
        continue;
      }
      for (const f of files) {
        const text = await readFile(path.join(dir, f), "utf8").catch(() => "");
        if (!text.includes(worktree)) continue; // cheap pre-filter
        const raw: RawUsage = { ...ZERO };
        let model = "";
        let ctxTokens = 0;
        let matched = false;
        for (const line of text.split("\n")) {
          if (!line.trim()) continue;
          let o: TranscriptLine;
          try {
            o = JSON.parse(line) as TranscriptLine;
          } catch {
            continue;
          }
          if (o.cwd && o.cwd !== worktree) continue;
          if (o.cwd === worktree) matched = true;
          const u = o.message?.usage ?? o.usage;
          if (u) {
            raw.inTok += u.input_tokens ?? 0;
            raw.outTok += u.output_tokens ?? 0;
            raw.cacheRead += u.cache_read_input_tokens ?? 0;
            raw.cacheWrite += u.cache_creation_input_tokens ?? 0;
            ctxTokens =
              (u.input_tokens ?? 0) +
              (u.cache_read_input_tokens ?? 0) +
              (u.cache_creation_input_tokens ?? 0);
            if (o.message?.model) model = o.message.model;
          }
        }
        if (matched) return { raw, model, ctxTokens };
      }
    }
  } catch {
    /* no transcript available */
  }
  return null;
}

export async function agentUsage(a: Agent): Promise<Usage> {
  let raw: RawUsage = { ...ZERO };
  let model = "";
  let ctxTokens = 0;
  let source: Usage["source"] = "none";

  const t = await claudeTranscript(a.worktree);
  if (t) {
    raw = t.raw;
    model = t.model;
    ctxTokens = t.ctxTokens;
    source = "transcript";
  } else if (a.usage) {
    raw = a.usage;
    model = a.usageModel ?? "";
    ctxTokens = a.usageCtx ?? 0;
    source = "push";
  }

  const p = model ? priceFor(model) : null;
  return {
    ...raw,
    model,
    source,
    costUSD: p ? costUSD(raw, p) : null,
    ctxPct: p && ctxTokens ? Math.min(100, Math.round((ctxTokens / p.context) * 100)) : null,
  };
}
