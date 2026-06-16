export type Status = "running" | "waiting" | "done" | "error" | "dead";

export interface RawUsageCounts {
  inTok: number;
  outTok: number;
  cacheRead: number;
  cacheWrite: number;
}

/** Computed usage for an agent (tokens + cost + context fill). */
export interface Usage extends RawUsageCounts {
  model: string;
  costUSD: number | null; // null when the model's price is unknown
  ctxPct: number | null; // % of the model's context window currently in use
  source: "transcript" | "push" | "none";
}

export interface Agent {
  name: string;
  repo: string; // abs path to main repo root
  worktree: string; // abs path to this agent's worktree
  branch: string;
  session: string; // tmux session name
  agent: string; // adapter key (claude, codex, ...)
  cmd: string; // launch command
  createdAt: string;
  status: Status; // self-reported via `hivemux notify`; overridden to "dead" if session gone
  note: string; // last notification text
  // Optional observability state:
  usage?: RawUsageCounts; // last usage pushed via `hivemux report-usage`
  usageModel?: string; // model reported alongside pushed usage
  usageCtx?: number; // context tokens reported alongside pushed usage
  costCap?: number; // alert when estimated cost (USD) crosses this
  ctxCap?: number; // alert when context fill (%) crosses this
  loop?: LoopInfo; // active/last loop-engineering run
}

export interface LoopInfo {
  goal: string;
  check?: string;
  rubric?: string;
  maxIters: number;
  iter: number;
  state: "running" | "passed" | "stopped";
}

/** Agent enriched with live tmux liveness. */
export interface AgentView extends Agent {
  alive: boolean;
}

export interface Conflict {
  repo: string;
  file: string;
  agents: string[]; // agent names whose worktrees both touch this file
}

/** AgentView plus computed usage — what the usage surfaces consume. */
export interface UsageView extends AgentView {
  usageView: Usage;
  overCost: boolean;
  overCtx: boolean;
}

export interface NewAgentOpts {
  name: string;
  agent: string; // adapter key
  repo: string; // dir to resolve repo root from
  branch?: string;
  base?: string;
  costCap?: number;
  ctxCap?: number;
}
