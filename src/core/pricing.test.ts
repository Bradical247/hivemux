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
});

describe("usage push-path", () => {
  test("computes cost from pushed usage when no transcript matches", async () => {
    const a: Agent = {
      name: "x",
      repo: "/nope",
      worktree: "/nonexistent-amux-test-worktree-zzz",
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
