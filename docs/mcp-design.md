# MCP integration — design exploration

Goal: make hivemux the **execution layer for AI workflows** — a conductor agent
(in Claude Code / Desktop / Cursor) drives a fleet of hivemux worker agents over
MCP, each verified, tool-equipped, and cost-capped.

Two directions (build A first, B alongside):
- **A. hivemux as an MCP server** (`hivemux mcp`) — exposes orchestration as tools.
- **B. per-agent MCP provisioning** — workers inherit MCP tools automatically.

---

## Concrete workflows (the value)

### 1. Bug-fix fan-out
Conductor: *"Fix these 3 failing tests, one agent each, loop until green, merge the passes, cap $5 total."*
```
spawn_agent(repo, name:"fix-a")  spawn_agent(... "fix-b")  spawn_agent(... "fix-c")
start_loop("fix-a", goal:"make test X pass", check:"bun test X", max:8)   # ×3
… poll get_status until each loop ends …
merge("fix-a")  merge("fix-b")        # only the ones that passed
```

### 2. Parallel-approach tournament
*"Try 3 different approaches to this refactor; keep the first that passes, kill the rest."*
```
start_loop(fleet:3, base:"refactor", goal:"…", check:"bun test")
# fleet runs in parallel, each its own worktree; conductor merges the first PASS, kills others
```

### 3. Overnight, budget-bounded
*"Across these 6 modules, one agent each, loop until lint+tests pass, $2 cap per agent, stop at $10 total. I'll check the dashboard tomorrow."*
Conductor fans out with per-agent `cost_cap`; hivemux runs headless; human watches `hivemux web`.

### 4. Migration sweep with conflict gate
*"Rename API X→Y across the repo. Fan out by directory; before merging, flag any file two agents both touched."*
```
spawn per dir → start_loop each → conflicts() → merge only the non-conflicting → report collisions
```

---

## Proposed MCP tool surface

Few, composable, LLM-ergonomic tools. Structured JSON returns.

| Tool | Params | Returns | Notes |
|---|---|---|---|
| `spawn_agent` | repo, agent?, name?, cost_cap?, mcp? | {name, branch, worktree} | creates worktree + agent |
| `start_loop` | name? \| (base+fleet), goal, check? \| rubric?, max?, commit?, pr? | {loop_id, names[]} | **non-blocking** — returns immediately |
| `get_status` | name? | [{name, status, loop:{iter,state}, cost, ctxPct}] | poll this for progress |
| `list_agents` | — | [{name, status, branch, alive}] | |
| `usage` | — | [{name, model, tokens, costUSD}] + total | |
| `conflicts` | — | [{file, agents[]}] | merge-collision gate |
| `merge` | name, into? | {merged, into, conflicts[]} | |
| `kill` | name, rm_worktree? | {ok} | |
| `broadcast` | names[]?, text | {sent[]} | |

Design rules: tool descriptions state *when* to call (Opus-4.x reaches for tools
conservatively); every tool idempotent-friendly; errors returned as structured
`{error}` not exceptions.

---

## The critical design decision: long-running loops over MCP

A loop runs **minutes**; an MCP `tools/call` is request/response. Blocking the call
for a multi-minute loop is fragile (client timeouts, no progress).

**Decision: fire-and-poll.**
- `start_loop` launches the loop **in a background runner** and returns a `loop_id`
  immediately.
- The conductor polls `get_status` (loop iter/state/cost) until terminal.
- This needs a **background loop runner** — the `hivemux daemon` owns running loops
  (today loops run in the foreground `hivemux loop` process). So: MCP server →
  daemon → detached loop execution → status in the store the dashboard already reads.

Implication: building A well means **moving loop execution into the daemon** (a real
but worthwhile refactor — it also lets the web dashboard show/stop running loops).

---

## Conductor UX

Setup (one line):
```
claude mcp add hivemux -- hivemux mcp        # or a .mcp.json entry
```
Then the top-level agent just talks:
> "Spin up agents for the 3 TODOs in issues.md, loop each until `bun test` passes,
>  cap $3 each, and tell me which merged."

`spawn_agent` returns the **dashboard URL** so the human can watch the fleet live.

---

## B. Per-agent MCP provisioning

`spawn_agent(..., mcp:["github","postgres"])` (or an agent profile in
`~/.hivemux/config.json`) writes the worktree's `.mcp.json` so every worker inherits
those servers. Define a fleet's toolset once; the swarm is consistent.

---

## Open questions to settle before building

1. **Blocking vs fire-and-poll** for `start_loop` → recommend fire-and-poll (above).
   Confirm we're OK doing the daemon-loop-runner refactor it implies.
2. **Safety/blast radius**: a conductor can spawn N permission-bearing agents.
   Defaults: `acceptEdits` (not skip-permissions), mandatory cost caps, a max-concurrent-agents
   limit, optional repo allowlist. Agree on defaults.
3. **Tool granularity**: many small tools (proposed) vs one `orchestrate` mega-tool.
   Recommend small/composable.
4. **MCP SDK vs hand-rolled stdio**: `@modelcontextprotocol/sdk` (dep, correct) vs
   hand-rolled JSON-RPC stdio (zero-dep, we did the daemon this way). Lean hand-rolled
   to stay single-binary, unless the SDK earns its weight.
5. **Where loops run when started via MCP**: daemon (recommended) vs detached `hivemux loop`
   subprocesses. Daemon centralizes status + lets the dashboard stop them.
