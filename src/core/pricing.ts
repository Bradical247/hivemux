// Token pricing, provider-agnostic. All rates are USD per 1,000,000 tokens.
// Built-in Anthropic rates are grounded against the Anthropic pricing reference
// (cached 2026-06-04). Rates for ANY other model/provider (OpenAI, Gemini, …)
// are supplied or overridden via ~/.amux/config.json:
//   { "pricing": { "gpt-5": { "in": 1.25, "out": 10, "context": 400000 } } }
// amux ships no prices it can't cite; unknown models show cost as "—".
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface ModelPrice {
  in: number; // $/1M input tokens
  out: number; // $/1M output tokens
  cacheRead?: number; // default: in * 0.1
  cacheWrite?: number; // default: in * 1.25
  context: number; // context window in tokens
}

export interface RawUsage {
  inTok: number;
  outTok: number;
  cacheRead: number;
  cacheWrite: number;
}

const BUILTIN: Record<string, ModelPrice> = {
  "claude-fable-5": { in: 10, out: 50, context: 1_000_000 },
  "claude-opus-4-8": { in: 5, out: 25, context: 1_000_000 },
  "claude-opus-4-7": { in: 5, out: 25, context: 1_000_000 },
  "claude-opus-4-6": { in: 5, out: 25, context: 1_000_000 },
  "claude-sonnet-4-6": { in: 3, out: 15, context: 1_000_000 },
  "claude-haiku-4-5": { in: 1, out: 5, context: 200_000 },
};

function userPricing(): Record<string, ModelPrice> {
  try {
    const cfg = JSON.parse(readFileSync(path.join(os.homedir(), ".amux", "config.json"), "utf8"));
    return (cfg.pricing ?? {}) as Record<string, ModelPrice>;
  } catch {
    return {};
  }
}

/** Exact match first, then longest prefix (so dated model IDs resolve). */
export function priceFor(model: string): ModelPrice | null {
  const all = { ...BUILTIN, ...userPricing() };
  const direct = all[model];
  if (direct) return direct;
  const key = Object.keys(all)
    .filter((k) => model.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return key ? (all[key] ?? null) : null;
}

export function costUSD(u: RawUsage, p: ModelPrice): number {
  const cr = p.cacheRead ?? p.in * 0.1;
  const cw = p.cacheWrite ?? p.in * 1.25;
  return (u.inTok * p.in + u.outTok * p.out + u.cacheRead * cr + u.cacheWrite * cw) / 1_000_000;
}
