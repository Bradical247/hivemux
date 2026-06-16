// hivemux as an MCP server (stdio, JSON-RPC 2.0, newline-delimited). Any MCP
// client (Claude Code/Desktop, Cursor, …) can drive a hivemux fleet: a conductor
// agent spawns workers, starts verify→fix loops, watches status, merges the
// passes — all over these tools.
//
// Long-running loops are FIRE-AND-POLL: `start_loop` launches in the background
// (inside this server process) and returns immediately; the conductor polls
// `get_status`. Safety defaults: a mandatory cost cap per agent, a max-concurrent
// limit, and acceptEdits (never skip-permissions) from the loop runner.
import * as readline from "node:readline";
import * as mgr from "../core/manager";

const VERSION = "1.2.0";
const MAX_AGENTS = 12;
const DEFAULT_COST_CAP = 5;

interface RpcRequest {
  jsonrpc: string;
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

function send(msg: unknown): void {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}
function reply(id: RpcRequest["id"], result: unknown): void {
  send({ jsonrpc: "2.0", id, result });
}
function fail(id: RpcRequest["id"], message: string): void {
  send({ jsonrpc: "2.0", id, error: { code: -32000, message } });
}

const obj = (props: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties: props,
  required,
});
const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });
const bool = (description: string) => ({ type: "boolean", description });

const TOOLS = [
  {
    name: "spawn_agent",
    description:
      "Create an isolated worker agent (its own git worktree + tmux session). Call this before start_loop when you need a named agent.",
    inputSchema: obj(
      {
        repo: str("path to the git repo to branch from"),
        name: str("agent name (auto-generated if omitted)"),
        agent: str("agent adapter (default: claude)"),
        cost_cap: num("USD spend cap for this agent (default 5)"),
      },
      ["repo"],
    ),
  },
  {
    name: "start_loop",
    description:
      "Start a verify→fix loop on an agent (or a fleet). Non-blocking — returns immediately; poll get_status. Use a shell `check` (exit 0 = pass) or an LLM `rubric`.",
    inputSchema: obj(
      {
        name: str("existing agent to loop (omit when using fleet)"),
        goal: str("what the agent should achieve"),
        check: str("shell verifier, exit 0 = pass"),
        rubric: str("LLM-judge criteria (used when no check)"),
        max: num("max iterations (default 10)"),
        fleet: num("run the same goal on N fresh agents (with base+repo)"),
        base: str("base name for fleet agents"),
        repo: str("repo for fleet agents"),
        commit: bool("git commit on pass"),
        pr: bool("open a PR on pass"),
      },
      ["goal"],
    ),
  },
  {
    name: "get_status",
    description: "Status + loop state + cost for agents (poll this).",
    inputSchema: obj({ name: str("filter to one agent") }),
  },
  { name: "list_agents", description: "List all agents.", inputSchema: obj({}) },
  { name: "usage", description: "Token usage + estimated cost per agent.", inputSchema: obj({}) },
  {
    name: "conflicts",
    description: "Files changed by more than one agent (merge collisions).",
    inputSchema: obj({}),
  },
  {
    name: "merge",
    description: "Merge an agent's branch into the base branch.",
    inputSchema: obj({ name: str("agent"), into: str("target branch") }, ["name"]),
  },
  {
    name: "kill",
    description: "Stop an agent and deregister it.",
    inputSchema: obj({ name: str("agent"), rm_worktree: bool("also remove the worktree") }, [
      "name",
    ]),
  },
  {
    name: "broadcast",
    description: "Send a prompt to agents' sessions.",
    inputSchema: obj(
      { names: { type: "array", items: { type: "string" } }, text: str("message") },
      ["text"],
    ),
  },
];

async function callTool(name: string, a: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "spawn_agent": {
      const live = (await mgr.list()).filter((x) => x.alive).length;
      if (live >= MAX_AGENTS) throw new Error(`max concurrent agents (${MAX_AGENTS}) reached`);
      const agent = await mgr.create({
        name: (a.name as string) || `agent-${Date.now().toString(36)}`,
        agent: (a.agent as string) || "claude",
        repo: (a.repo as string) || process.cwd(),
        costCap: typeof a.cost_cap === "number" ? a.cost_cap : DEFAULT_COST_CAP,
      });
      return { name: agent.name, branch: agent.branch, worktree: agent.worktree };
    }
    case "start_loop": {
      const spec = {
        goal: a.goal as string,
        check: a.check as string | undefined,
        rubric: a.rubric as string | undefined,
        maxIters: typeof a.max === "number" ? a.max : 10,
      };
      if (!spec.check && !spec.rubric) throw new Error("need check or rubric");
      const opts = { commit: Boolean(a.commit), pr: Boolean(a.pr) };
      if (typeof a.fleet === "number" && a.fleet > 0) {
        const base = (a.base as string) || `fleet-${Date.now().toString(36)}`;
        // fire-and-poll: do not await
        void mgr
          .fleetLoop(base, a.fleet, "claude", (a.repo as string) || process.cwd(), spec, opts)
          .catch(() => {});
        return { started: Array.from({ length: a.fleet }, (_, i) => `${base}-${i + 1}`) };
      }
      const name = a.name as string;
      if (!name) throw new Error("need name (or fleet)");
      void mgr.loop(name, spec, opts).catch(() => {});
      return { started: [name] };
    }
    case "get_status": {
      const rows = await mgr.usageAll();
      const filtered = a.name ? rows.filter((r) => r.name === a.name) : rows;
      return filtered.map((r) => ({
        name: r.name,
        status: r.status,
        alive: r.alive,
        loop: r.loop ?? null,
        costUSD: r.usageView.costUSD,
        ctxPct: r.usageView.ctxPct,
      }));
    }
    case "list_agents":
      return (await mgr.list()).map((x) => ({
        name: x.name,
        status: x.status,
        branch: x.branch,
        alive: x.alive,
      }));
    case "usage":
      return (await mgr.usageAll()).map((r) => ({
        name: r.name,
        model: r.usageView.model,
        inTok: r.usageView.inTok,
        outTok: r.usageView.outTok,
        costUSD: r.usageView.costUSD,
      }));
    case "conflicts":
      return mgr.conflicts();
    case "merge":
      return mgr.merge(a.name as string, { into: a.into as string | undefined });
    case "kill":
      await mgr.kill(a.name as string, Boolean(a.rm_worktree));
      return { ok: true };
    case "broadcast":
      return { sent: await mgr.broadcast((a.names as string[]) ?? [], (a.text as string) ?? "") };
    default:
      throw new Error(`unknown tool '${name}'`);
  }
}

export async function runMcp(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let req: RpcRequest;
    try {
      req = JSON.parse(line) as RpcRequest;
    } catch {
      continue;
    }
    try {
      if (req.method === "initialize") {
        reply(req.id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "hivemux", version: VERSION },
        });
      } else if (req.method === "tools/list") {
        reply(req.id, { tools: TOOLS });
      } else if (req.method === "tools/call") {
        const p = req.params ?? {};
        const result = await callTool(
          p.name as string,
          (p.arguments as Record<string, unknown>) ?? {},
        );
        reply(req.id, {
          content: [
            {
              type: "text",
              text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
            },
          ],
        });
      } else if (req.id != null) {
        // notifications (no id) are ignored; only error on id-bearing unknown calls
        fail(req.id, `unknown method '${req.method}'`);
      }
    } catch (e) {
      if (req.id != null) fail(req.id, (e as Error).message);
    }
  }
}
