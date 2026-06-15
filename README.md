<div align="center">

<img src="assets/banner.svg" alt="amux" width="660" />

**A Linux-native, tmux-backed orchestrator for parallel AI coding agents.**

[![CI](https://github.com/Bradical247/amux/actions/workflows/ci.yml/badge.svg)](https://github.com/Bradical247/amux/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-3fb950.svg)](LICENSE)
![Runtime: Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun&logoColor=black)
![Built on tmux](https://img.shields.io/badge/built%20on-tmux-1BB91F?logo=tmux&logoColor=white)

</div>

<p align="center"><img src="assets/demo.gif" alt="amux demo" width="820" /></p>

<p align="center"><img src="assets/gui.png" alt="amux GUI" width="820" /><br/><sub>the <code>amux gui</code> desktop window — sidebar workspaces + embedded live terminals</sub></p>

Run many coding agents (Claude Code, Codex, Gemini, Aider, …) at once — each in
its own isolated git worktree and tmux session — and manage them all from one
place. Unlike desktop-GUI orchestrators, amux is built on tmux, so it runs
**headless over SSH, persists across disconnects, and lives on a remote box you
attach to from anywhere**.

> Inspired by [cmux](https://github.com/manaflow-ai/cmux) (macOS/Ghostty).
> amux trades the native GUI for the thing macOS terminals can't give you:
> the server room.

## Features

- 🖥️ **Desktop GUI** — `amux gui` opens a cmux-style app window: a sidebar of agent
  workspaces (status + notification rings) and an **embedded live terminal** per
  agent (via [ttyd](https://github.com/tsl0922/ttyd)), with merge / PR / broadcast / kill in the toolbar.
- 🧬 **Parallel agents, fully isolated** — each agent runs in its own git worktree
  (its own branch, no file collisions) and its own tmux session.
- 🛰️ **Headless & remote-first** — tmux-backed, so it runs over SSH on a server, the
  agents survive disconnects, and you reattach from anywhere. (cmux is desktop-only.)
- 📊 **Many ways to watch** — `amux ls` table, a live **TUI** (`amux dash`), a tiled
  terminal view (`amux grid`), and a remote-reachable **web dashboard** (`amux web`).
- ⚠️ **Conflict detection** — surfaces files touched by more than one agent *before*
  you merge, in the CLI and both dashboards.
- 🔀 **Merge / PR orchestration** — `amux merge` lands a branch (clean-aborts on
  conflict); `amux pr` pushes and opens a GitHub PR.
- 📣 **Broadcast** — `amux broadcast` types the same prompt into many agents at once.
- 🔔 **Status notifications** — agents report `waiting`/`done`/`error` via `amux notify`
  (wire it into agent hooks); a daemon pushes live events to every client.
- 🔒 **Authenticated when exposed** — the web dashboard auto-mints a token the moment
  it binds beyond loopback.
- 📦 **Single-binary distribution** — `bun build --compile` produces one self-contained
  executable; the target machine needs nothing installed.

## Why tmux as the base

tmux already solves the hard parts — PTYs, sessions, panes, and **persistence
across disconnects**. amux doesn't reimplement any of it. It's a thin layer that
adds the agent-specific concerns on top:

| Concern | Who handles it |
|---|---|
| PTY / session / pane / persistence | tmux |
| Isolated working dir per agent | git worktree |
| Spawn / list / attach / kill agents | amux |
| Status + notifications ("agent is waiting") | amux + agent hooks |

## Status

**v0.5.** Working: `new`, `ls`, `attach`, `kill`, `notify`, `agents`, `conflicts`,
`broadcast`, `merge`, `pr`, `dash` (live TUI), `grid` (tiled live view), `web`
(dashboard + SSE + auth + create form), `gui` (cmux-style desktop window),
`daemon`, `watch`.

## Commands

```
amux new <name> [--agent claude] [--repo .] [--branch b] [--base ref]
amux ls
amux attach <name>
amux kill <name> [--rm-worktree]
amux notify [--name n] --status waiting --note "..."
amux conflicts                       # files touched by >1 agent (merge collisions)
amux broadcast [names...] -m "..."   # type a prompt into agents' sessions (all if no names)
amux merge <name> [--into b] [--ff]  # merge an agent's branch into the base branch
amux pr <name> [-t title] [--draft]  # push branch + open a GitHub PR (needs gh)
amux dash                            # live full-screen TUI (status table)
amux grid                            # tiled, read-only live view of all agents
amux web [--port 7878] [--host 0.0.0.0] [--token t]   # web dashboard, SSE live updates
amux gui [--port 7878]               # cmux-style desktop app window (needs ttyd + a browser)
amux daemon                          # control-plane daemon (event push, remote API)
amux watch                           # stream live status from the daemon
amux agents
```

Exposing the web dashboard beyond loopback (`--host 0.0.0.0`) auto-generates an auth
token if you don't pass `--token`; the printed URL includes it (`?token=…`), and the
API also accepts an `x-amux-token` header.

## Install

### Desktop app (Linux)

Grab the **AppImage** or **`.deb`** from
[Releases](https://github.com/Bradical247/amux/releases/latest) — a real desktop
app (cmux-style window) that bundles `amux` + `ttyd`, nothing else to install.
Built by CI on each tagged release (`electron/`).

### CLI / from source

```bash
git clone https://github.com/Bradical247/amux && cd amux
bun install
bun run build      # compiles a single standalone binary -> dist/amux
```

`bun run build` produces a self-contained executable (the Bun runtime is embedded),
so the target machine needs **nothing installed** to run it — copy `dist/amux` to a
server and go. This is the distribution edge over cmux's macOS `.dmg`: one static
Linux binary, headless-friendly.

Requires (build/dev): [Bun](https://bun.sh) `>= 1.1`, `tmux >= 3.2`, `git`, plus
whatever agent CLIs you drive. Dev without building: `bun src/cli.ts <args>`.

## Quickstart

```bash
cd ~/your-repo

amux new fix-auth                 # worktree + tmux session, launches `claude`
amux new add-tests --agent aider  # a second agent, isolated from the first
amux ls                           # see them all + status
amux attach fix-auth              # drop into one
# Ctrl-b d to detach; the agent keeps running
amux kill fix-auth --rm-worktree  # tear it down
```

### Status notifications (cmux-style "waiting" signal)

Each session gets `$AMUX_NAME` in its env. Wire your agent's hooks to report
back, so `amux ls` shows when an agent is blocked on you:

```bash
# e.g. a Claude Code Stop hook:
amux notify --status waiting --note "needs review"
```

## Configuration

`~/.amux/config.json` to add or override agent adapters:

```json
{
  "agents": {
    "claude-yolo": { "cmd": "claude --dangerously-skip-permissions" }
  }
}
```

State lives in `~/.amux/state.json`; worktrees in `~/.amux/worktrees/<repo>/<name>`.

## Roadmap

- [x] **`amux dash`** — live TUI dashboard driven by the shared watcher.
- [x] **Web dashboard** — remote-accessible UI + SSE; the cmux experience, reachable from anywhere.
- [x] **Conflict detection** — flag files touched by more than one agent before you merge.
- [x] **Socket/JSON API** — daemon control plane with event push (cmux parity).
- [x] **Merge/PR orchestration** — `amux merge` (clean-abort on conflict) and `amux pr` (push + `gh pr create`).
- [x] **`amux broadcast`** — send the same instruction to N agents at once.
- [x] **Web auth** — token required (auto-minted) whenever the dashboard binds beyond loopback.
- [x] **Single-binary distribution** — `bun build --compile` ships a self-contained executable.
- [x] **TUI: tiled live agent panes** — `amux grid` mirrors every live agent in a tiled, read-only view.
- [x] **Web: create-agent form** — spawn agents from the dashboard.
- [ ] **Go rewrite** — only if Bun's single-binary story proves insufficient.

## Architecture

Layered: one core, many frontends. No frontend touches tmux/git/store directly.

```
src/
  core/
    manager.ts   — the single orchestration API (create/list/kill/notify/conflicts)
    tmux.ts      — async wrapper over the tmux CLI
    git.ts       — worktrees + changed-file detection
    store.ts     — ~/.amux/state.json, atomic writes + cross-process lock
    watcher.ts   — shared poll loop → "tick"/"change"/"remove" events
    agents.ts    — pluggable agent adapters
    types.ts
  ipc/           — Unix-socket JSON daemon (server) + client + protocol
  tui/dash.ts    — zero-dep ANSI TUI over the watcher
  web/           — node:http + SSE dashboard (server + inlined page)
  cli.ts         — thin frontend over core
```

The store is the single source of truth (concurrency-safe), so CLI / daemon / web
never diverge. The daemon and web server each run a `Watcher` and push deltas to
their clients — no per-client tmux polling.

## License

MIT
