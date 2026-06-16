// The loop's decision state-machine and the shell verifier are deterministic, so
// they're unit tested here. (The live agent turn — send → Stop-hook signal →
// verify — needs a real agent + credits, so it's exercised manually, not here.)

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { decide, verifyShell } from "./loop";

describe("loop.decide", () => {
  const pass = { pass: true, feedback: "" };
  const fail = { pass: false, feedback: "boom" };

  test("passing verdict -> pass", () => {
    expect(decide(1, 10, pass, false).type).toBe("pass");
  });
  test("failing under budget -> retry with feedback in the prompt", () => {
    const a = decide(2, 10, fail, false);
    expect(a.type).toBe("retry");
    if (a.type === "retry") expect(a.prompt).toContain("boom");
  });
  test("over cap -> stop", () => {
    expect(decide(2, 10, fail, true).type).toBe("stop");
  });
  test("at max iterations -> stop", () => {
    const a = decide(10, 10, fail, false);
    expect(a.type).toBe("stop");
    if (a.type === "stop") expect(a.reason).toContain("max iterations");
  });
});

describe("loop.verifyShell", () => {
  test("exit 0 passes", async () => {
    const v = await verifyShell(tmpdir(), "true");
    expect(v.pass).toBe(true);
  });
  test("nonzero fails and captures output", async () => {
    const d = mkdtempSync(path.join(tmpdir(), "hm-loop-"));
    try {
      const v = await verifyShell(d, "echo NOPE >&2; exit 1");
      expect(v.pass).toBe(false);
      expect(v.feedback).toContain("NOPE");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
