# hivemux against the 12-Factor Agents

[12-Factor Agents](https://github.com/humanlayer/12-factor-agents) (humanlayer) is
a playbook of principles for production-grade LLM agents. hivemux is an
*orchestrator*, not the inner agent, so some factors it owns directly, some it
delegates to the runner (Claude Code / Codex / …), and a couple are out of scope.
This is an honest audit, used as a design checklist.

| # | Factor | hivemux | Where |
|---|--------|---------|-------|
| 1 | Natural language to tool calls | Delegated | the runner (claude/codex) does the NL→tool step inside its own loop |
| 2 | Own your prompts | Owned (loop) | the verify→fix loop builds the fix prompt and the LLM-judge grader prompt (`src/core/loop.ts`) |
| 3 | Own your context window | Delegated + observed | the runner owns its window; hivemux measures fill per agent and warns near the cap (`src/core/usage.ts`, ctx%) |
| 4 | Tools are structured outputs | Owned (MCP) | the MCP server's tools have JSON schemas; `start_loop` etc. validate inputs (`src/ipc/mcp.ts`) |
| 5 | Unify execution and business state | Owned | one `~/.hivemux/state.json` is the single source of truth for every agent; status is derived live from tmux |
| 6 | Launch / pause / resume with simple APIs | Owned | `loop` / `stop_loop`, the daemon, and resumable runner sessions (`--resume`); start is non-blocking, poll `get_status` |
| 7 | Contact humans with tool calls | Owned | the approval gate: `requireApproval` holds a commit/PR, surfaced as approve/deny in the CLI and GUI (`src/core/manager.ts`) |
| 8 | Own your control flow | Owned | the loop is an explicit verify→fix state machine, not an open-ended agent; `decide()` is a pure function |
| 9 | Compact errors into context | Owned (loop) | the verifier's output (failing test / judge feedback) is fed back into the next fix turn, truncated |
| 10 | Small, focused agents | Owned | one agent per git worktree + tmux session; isolated, no file collisions; fleet runs many small ones |
| 11 | Trigger from anywhere | Owned | CLI, live TUI, tiled view, web GUI, MCP, and headless over SSH; agents survive disconnects |
| 12 | Stateless reducer | Owned (loop) | `decide(state) -> action` is a pure reducer over loop state; the loop holds no hidden state between turns |

## Gaps / deliberate non-goals

- **Factor 1–3 inner-agent concerns** are the runner's job by design. hivemux is
  agent-agnostic; it does not reach inside the runner's prompt or context.
- **Factor 9** is best-effort: verifier feedback is truncated to a fixed budget,
  not semantically compacted.
- **Factor 4** structured outputs cover the MCP surface; the loop's own runner
  calls parse a JSON envelope (`claude-json`) or fall back to text.

## Safety posture (cross-cutting)

- Loops run with `acceptEdits`, never `--dangerously-skip-permissions`.
- A per-agent cost cap plus a global policy (`sandbox`, `network`, `maxCostUSD`,
  `requireApproval`) bound every run (`src/core/policy.ts`).
- OS sandbox (bwrap / seatbelt) confines an agent to its worktree when enabled.
