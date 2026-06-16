// Pluggable agent adapters. Built-ins below; override or add via
// ~/.hivemux/config.json -> { "agents": { "myagent": { "cmd": "..." } } }.
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface AgentDef {
  cmd: string; // command run inside the worktree's tmux session
}

export const DEFAULTS: Record<string, AgentDef> = {
  claude: { cmd: "claude" },
  codex: { cmd: "codex" },
  gemini: { cmd: "gemini" },
  aider: { cmd: "aider" },
  shell: { cmd: "" }, // just an interactive shell in the worktree
};

async function userAgents(): Promise<Record<string, AgentDef>> {
  const cfgPath = path.join(os.homedir(), ".hivemux", "config.json");
  try {
    const cfg = JSON.parse(await readFile(cfgPath, "utf8"));
    return (cfg.agents ?? {}) as Record<string, AgentDef>;
  } catch {
    return {};
  }
}

export async function resolveAgent(key: string): Promise<AgentDef> {
  const overrides = await userAgents();
  return overrides[key] ?? DEFAULTS[key] ?? { cmd: key };
}

export async function agentKeys(): Promise<string[]> {
  const overrides = await userAgents();
  return [...new Set([...Object.keys(DEFAULTS), ...Object.keys(overrides)])];
}
