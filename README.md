<div align="center">

<img src="assets/banner.svg" alt="hivemux" width="660" />

### A Linux-native, tmux-backed orchestrator for parallel AI coding agents.

[![CI](https://github.com/Bradical247/hivemux/actions/workflows/ci.yml/badge.svg)](https://github.com/Bradical247/hivemux/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/hivemux?logo=npm&color=3fb950)](https://www.npmjs.com/package/hivemux)
[![npm downloads](https://img.shields.io/npm/dm/hivemux?color=3fb950)](https://www.npmjs.com/package/hivemux)
[![License: MIT](https://img.shields.io/badge/license-MIT-3fb950.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-linux%20%7C%20macOS-555)
![Runtime: Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun&logoColor=black)
![Built on tmux](https://img.shields.io/badge/built%20on-tmux-1BB91F?logo=tmux&logoColor=white)

</div>

<p align="center"><img src="assets/gui-grid.gif" alt="three Claude Code agents fixing bugs in parallel" width="840" /></p>
<p align="center"><sub>Three real Claude Code agents fixing separate bugs in parallel, each in its own worktree. A tile lights up, blinks, and chimes the moment its agent finishes.</sub></p>

Run a swarm of coding agents (Claude Code, Codex, Gemini, Aider, …) at once. Each
gets **its own git worktree and tmux session**, so they never collide. Drive them
from a CLI, a live TUI, a tiled web GUI, or a conductor agent over **MCP**.

Because it is built on tmux, hivemux runs **headless over SSH**, **survives
disconnects**, and lives on a box you attach to from anywhere. The desktop app and
web dashboard are just frontends over the same tmux-backed core, so you get the GUI
*and* the server room.

> Inspired by [cmux](https://github.com/manaflow-ai/cmux) (macOS/Ghostty). hivemux
> takes the opposite bet: trade the native GUI for what a terminal multiplexer
> gives you for free.

## Quickstart

```bash
# build a single self-contained binary (needs Bun, tmux, git)
git clone https://github.com/Bradical247/hivemux && cd hivemux
bun install && bun run build        # -> dist/hivemux

cd ~/your-repo
hivemux new fix-auth                 # worktree + tmux session, launches the agent
hivemux loop fix-auth \              # iterate -> verify -> fix until the check passes
  --goal "make the failing test pass" --check "bun test" --watch
hivemux                              # bare hivemux opens the GUI (same as `hivemux gui`)
```

<p align="center"><img src="assets/demo.gif" alt="hivemux loop fixing a bug to green" width="820" /></p>
<p align="center"><sub><code>hivemux loop --watch</code>: a real agent reasons live, fixes the bug, drives the verifier to green.</sub></p>

New here? Read the [usage guide](docs/GUIDE.md) for task-oriented recipes, or the
[GUI manual](docs/GUI.md) for an annotated tour of every control in the window.

## Features

- 🔌 **MCP server**: `hivemux mcp` exposes the orchestration as MCP tools, so a
  conductor agent (Claude Code/Desktop, Cursor) runs a fleet conversationally:
  *"fan out 3 agents on these bugs, loop each until tests pass, $3 cap, merge the greens."*
- 🔁 **Loop engineering**: `hivemux loop` drives an agent through iterate → verify →
  fix until a shell check or LLM judge passes (or it hits a max-iteration / cost cap).
  `--fleet N` races N agents; `--commit`/`--pr` land it; `--watch` streams the agent's
  reasoning live; `--ponytail` flips it to lazy-senior-dev mode.
- 🐝 **Fully isolated agents**: each runs in its own git worktree (own branch, no file
  collisions) and its own tmux session. Not in a repo? hivemux git-inits a fresh one,
  so you can start a session from any folder (`--no-init` to opt out).
- 🖥️ **Desktop + web GUI**: `hivemux gui` opens a cmux-style window: sidebar workspaces,
  embedded live terminals, a toolbar that drives everything, and a **tile view** of
  every agent at once with finish-flash + chime.
- 🛰️ **Headless and remote-first**: tmux-backed, so it runs over SSH; agents survive
  disconnects and you reattach from anywhere.
- 💰 **Usage and cost observability**: per-agent tokens, estimated cost, and context fill.
  Anthropic rates ship grounded; price any other model via config. Cost/context caps fire
  a chime + Slack/webhook alert.
- 🛡️ **Sandboxed and governed**: looped agents run under an OS sandbox (bwrap/seatbelt)
  confined to their worktree. A `policy` block sets sandbox, network, a hard cost ceiling,
  and `requireApproval` (hold commit/PR for `hivemux approve`).
- 🔀 **Merge / PR / broadcast**: land a branch (clean-abort on conflict), open a GitHub PR,
  or type one prompt into N agents at once. Conflict detection flags files >1 agent touched.
- 📦 **Single binary**: `bun build --compile` produces one self-contained executable; the
  target machine needs nothing installed.

## Drive a fleet from a conductor agent (MCP)

```bash
claude mcp add hivemux -- hivemux mcp     # register once
```

Then the top-level agent orchestrates conversationally: *"spin up agents for the 3
TODOs, loop each until `bun test` passes, $3 cap each, merge the passes."* Tools:
`spawn_agent`, `start_loop` (non-blocking, poll `get_status`), `usage`, `conflicts`,
`merge`, `kill`, `broadcast`. Cost-capped and concurrency-limited by default.

## Install

```bash
npm install -g hivemux          # or: npx hivemux
brew install bradical247/hivemux/hivemux
```

Both grab the prebuilt binary for your platform (linux-x64 / macos-arm64). Or grab a
desktop app / raw binary from [Releases](https://github.com/Bradical247/hivemux/releases/latest):

| Platform | Artifact |
|---|---|
| Linux desktop app | `*.AppImage` or `*.deb` (bundles `hivemux` + `ttyd`) |
| macOS desktop app | `*.dmg` (Apple Silicon; unsigned, right-click → Open the first time) |
| CLI only | the raw `hivemux-linux-x64` / `hivemux-macos-arm64` binary |

Or build from source (above). The compiled binary embeds the Bun runtime, so a target
machine needs **nothing installed** to run it; copy `dist/hivemux` to a server and go.
Build/dev needs [Bun](https://bun.sh) `>= 1.1`, `tmux >= 3.2`, `git`, plus whatever
agent CLIs you drive.

## Commands

<details>
<summary><b>Full command reference</b></summary>

```
hivemux new <name> [--agent claude] [--repo .] [--branch b] [--base ref]
hivemux ls
hivemux attach <name>
hivemux kill <name> [--rm-worktree]
hivemux notify [--name n] --status waiting --note "..."
hivemux conflicts                       # files touched by >1 agent (merge collisions)
hivemux usage [--json]                  # tokens, estimated cost, context-fill per agent + total
hivemux report-usage [--name n] --model m --in N --out N --ctx N   # push usage (from agent hooks)
hivemux broadcast [names...] -m "..."   # type a prompt into agents' sessions (all if no names)
hivemux merge <name> [--into b] [--ff]  # merge an agent's branch into the base branch
hivemux pr <name> [-t title] [--draft]  # push branch + open a GitHub PR (needs gh)
hivemux loop <name> --goal "..." --check "cmd" [--rubric t] [--max N] [--fleet N] [--detach] [--commit] [--pr] [--ponytail] [--sandbox auto|on|off] [--watch]
hivemux loop-list / loop-stop <name> / loop-log <name>   # manage detached loops (need the daemon)
hivemux dash                            # live full-screen TUI (status table)
hivemux grid                            # tiled, read-only live view of all agents
hivemux web [--port 7878] [--host 0.0.0.0] [--token t]   # web dashboard, SSE live updates
hivemux                                 # bare invocation = gui (the default action)
hivemux gui [--port 7878]               # cmux-style desktop app window (needs ttyd + a browser)
hivemux daemon                          # control-plane daemon (event push, remote API)
hivemux watch                           # stream live status from the daemon
hivemux mcp                             # run as an MCP server (stdio); a conductor agent drives the fleet
hivemux agents
hivemux approve [name]                  # perform a commit/PR held by requireApproval (no name = list)
hivemux deny <name>                     # discard a held commit/PR
hivemux doctor                          # check deps (tmux, ttyd, browser, gh) + sandbox availability
```

Each session gets `$HIVEMUX_NAME` in its env. Wire your agent's hooks to report back
(e.g. a Claude Code Stop hook running `hivemux notify --status waiting`), so `hivemux ls`
shows when an agent is blocked on you.

</details>

<details>
<summary><b>More screenshots</b></summary>

<p align="center"><img src="assets/gui.png" alt="hivemux GUI" width="820" /><br/><sub>the <code>hivemux gui</code> window: sidebar workspaces, embedded terminals, full toolbar</sub></p>
<p align="center"><img src="assets/gui-mcp.png" alt="hivemux MCP panel" width="820" /><br/><sub>the in-app MCP panel: copy-paste client config and the live tool list</sub></p>

</details>

## Configuration

`~/.hivemux/config.json` adds or overrides agent adapters, runners, pricing, alerts, and policy:

```json
{
  "agents": {
    "claude-yolo": { "cmd": "claude --dangerously-skip-permissions" }
  },
  "runners": {
    "gemini": { "bin": "gemini", "args": ["-p", "{prompt}"], "parse": "text" },
    "codex":  { "bin": "codex", "args": ["exec", "{prompt}"], "parse": "text" }
  },
  "pricing": {
    "gpt-5": { "in": 1.25, "out": 10, "context": 400000 }
  },
  "integrations": {
    "slackWebhook": "https://hooks.slack.com/services/…",
    "webhook": "https://example.com/hivemux"
  },
  "policy": {
    "sandbox": "auto",
    "network": true,
    "maxCostUSD": 5,
    "requireApproval": false
  }
}
```

- **`pricing`** is USD per 1M tokens (`cacheRead`/`cacheWrite` default to 0.1× / 1.25× of
  `in`). Built-in Anthropic models are grounded; add entries for any other LLM.
- **`policy`** governs looped agents: `sandbox` (`auto`/`on`/`off`) confines the agent to
  its worktree, `network` toggles network inside it, `maxCostUSD` is a hard ceiling, and
  `requireApproval` holds any commit/PR for `hivemux approve`. Run `hivemux doctor` to see
  what's installed.

State lives in `~/.hivemux/state.json`; worktrees in `~/.hivemux/worktrees/<repo>/<name>`.

## Develop

```bash
bun run check                       # typecheck + lint + unit tests
bun run build && bun run test:e2e   # Playwright E2E of the web GUI (uses system Chrome)
bun run pack                        # bundle the repo to one file for an LLM (repomix)
```

Layered: one core, many frontends. No frontend touches tmux/git/store directly.

```
src/
  core/      manager (orchestration API) · tmux · git worktrees · state store ·
             watcher (poll loop -> events) · agents · pricing/usage · sandbox · policy
  ipc/       Unix-socket JSON daemon (server + client + protocol) and the MCP server
  tui/       zero-dep ANSI TUI over the watcher
  web/       node:http + SSE dashboard (server + inlined page)
  cli.ts     thin frontend over core
```

The store is the single source of truth (concurrency-safe), so CLI / daemon / web never
diverge. See [docs/DESIGN-12factor.md](docs/DESIGN-12factor.md) for how the loop engine
maps onto the [12-Factor Agents](https://github.com/humanlayer/12-factor-agents) principles.

## Credits

- [cmux](https://github.com/manaflow-ai/cmux) for the parallel-agent workflow that inspired this.
- [Ponytail](https://github.com/DietrichGebert/ponytail) by Dietrich Gebert (MIT) for the directive behind `--ponytail`.
- [tmux](https://github.com/tmux/tmux) and [ttyd](https://github.com/tsl0922/ttyd), which do the heavy lifting.

## License

MIT
