// Pricing math + the usage push-path are pure/deterministic, so they're unit
// tested here. (Transcript parsing depends on a real ~/.claude tree, so it's
// exercised via the runtime smoke test, not here.) Run with `bun test`.
import { describe, expect, test } from "bun:test";
import { costUSD, priceFor } from "./pricing";
import type { Agent } from "./types";
import { agentUsage } from "./usage";

describe("pricing", () => {
  test("built-in Anthropic rate resolves", () => {
    const p = priceFor("claude-opus-4-8");
    expect(p?.in).toBe(5);
    expect(p?.out).toBe(25);
    expect(p?.context).toBe(1_000_000);
  });

  test("prefix match resolves a dated model id", () => {
    expect(priceFor("claude-opus-4-8-20260101")?.in).toBe(5);
  });

  test("unknown model returns null (no fabricated price)", () => {
    expect(priceFor("some-unknown-model-9")).toBeNull();
  });

  test("cost math: 1M in + 1M out on opus = $30", () => {
    const p = priceFor("claude-opus-4-8");
    if (!p) throw new Error("price missing");
    const cost = costUSD({ inTok: 1_000_000, outTok: 1_000_000, cacheRead: 0, cacheWrite: 0 }, p);
    expect(cost).toBeCloseTo(30, 5);
  });

  // Regression lock for the full built-in Anthropic table. Cross-checked against
  // the ccusage / LiteLLM model-prices data and Anthropic's published per-1M rates.
  // If Anthropic changes a price, update both this table and pricing.ts together.
  test.each([
    ["claude-fable-5", 10, 50, 1_000_000],
    ["claude-opus-4-8", 5, 25, 1_000_000],
    ["claude-opus-4-7", 5, 25, 1_000_000],
    ["claude-opus-4-6", 5, 25, 1_000_000],
    ["claude-sonnet-4-6", 3, 15, 1_000_000],
    ["claude-haiku-4-5", 1, 5, 200_000],
  ])("rate lock: %s = $%d in / $%d out", (model, inR, outR, ctx) => {
    const p = priceFor(model as string);
    expect(p?.in).toBe(inR);
    expect(p?.out).toBe(outR);
    expect(p?.context).toBe(ctx);
  });

  // Anthropic cache convention (matches ccusage/LiteLLM): 5-min cache write = 1.25x
  // input, cache read = 0.1x input, when a model doesn't override them.
  test("default cache multipliers: write 1.25x in, read 0.1x in", () => {
    const p = priceFor("claude-opus-4-8");
    if (!p) throw new Error("price missing");
    // 1M cache-write on opus ($5 in) = $6.25; 1M cache-read = $0.50
    expect(costUSD({ inTok: 0, outTok: 0, cacheRead: 0, cacheWrite: 1_000_000 }, p)).toBeCloseTo(
      6.25,
      5,
    );
    expect(costUSD({ inTok: 0, outTok: 0, cacheRead: 1_000_000, cacheWrite: 0 }, p)).toBeCloseTo(
      0.5,
      5,
    );
  });
});

describe("usage push-path", () => {
  test("computes cost from pushed usage when no transcript matches", async () => {
    const a: Agent = {
      name: "x",
      repo: "/nope",
      worktree: "/nonexistent-hivemux-test-worktree-zzz",
      branch: "b",
      session: "s",
      agent: "claude",
      cmd: "",
      createdAt: "",
      status: "running",
      note: "",
      usage: { inTok: 1_000_000, outTok: 0, cacheRead: 0, cacheWrite: 0 },
      usageModel: "claude-haiku-4-5",
    };
    const u = await agentUsage(a);
    expect(u.source).toBe("push");
    expect(u.costUSD).toBeCloseTo(1, 5); // 1M input * $1/1M
  });
});
