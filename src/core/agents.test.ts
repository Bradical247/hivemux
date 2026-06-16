// Adapter resolution is the one piece of pure logic worth pinning down: built-ins
// resolve to their command, and an unknown key falls back to itself (treated as a
// bare command name). Run with `bun test`.
//
// resolveAgent merges ~/.hivemux/config.json over the built-ins, so the default
// `cmd` values are asserted against the exported DEFAULTS map directly (config-free)
// rather than through resolveAgent, which a developer's own overrides could change.
import { describe, expect, test } from "bun:test";
import { agentKeys, DEFAULTS, resolveAgent } from "./agents";

describe("agents", () => {
  test("built-in adapters define their command", () => {
    expect(DEFAULTS.claude?.cmd).toBe("claude");
    expect(DEFAULTS.shell?.cmd).toBe("");
  });

  test("unknown key falls back to itself", async () => {
    expect((await resolveAgent("my-custom-cli-zzz")).cmd).toBe("my-custom-cli-zzz");
  });

  test("agentKeys lists the built-ins", async () => {
    const keys = await agentKeys();
    expect(keys).toContain("claude");
    expect(keys).toContain("aider");
  });
});
