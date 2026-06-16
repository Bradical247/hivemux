# Changelog

All notable changes to hivemux are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions are semver.

## [1.4.0]

### Added
- **Full GUI parity** — the web/desktop dashboard now drives the whole feature set,
  not just create/merge/PR/kill:
  - **Loop** modal (replaces the old `prompt()` chain): goal, shell-check *or*
    LLM-judge rubric, max iterations, runner select, and commit/PR-on-pass toggles.
  - **Fleet** — start one goal across N fresh agents from the toolbar.
  - **MCP** panel — the `hivemux mcp` command, a copy-paste client config, and the
    live tool list (served from `/api/mcp`).
  - **Loop-history viewer** — click an agent's loop line to see its per-iteration
    record (`/api/loop/log`).
  - **Prune** button (`/api/prune`).
- New web endpoints: `/api/loop/log`, `/api/prune`, `/api/mcp`; `/api/loop/start`
  now accepts `rubric`, `runner`, `fleet`, `commit`, and `pr`.

### Changed
- Brand refreshed to a honeycomb mark; documentation de-emojified and tightened.
- **Custom hivemux icon set** — app/favicon icons (`favicon.ico` + SVG, apple-touch,
  PWA 192/512 + maskable, electron) generated from the honeycomb mark and embedded in
  the web server (`/favicon.svg`, `/manifest.webmanifest`, `/icon-*.png`), so the
  dashboard is installable as a PWA. The GUI toolbar now uses hive-forward glyph icons,
  the sidebar status marks are honeycomb cells (not plain dots), and the CLI prints an
  ASCII honeycomb banner.

## [1.3.0]

### Added
- **Daemon-hosted loops** — `hivemux loop --detach` runs the loop inside the daemon
  so it survives client disconnect. Loops are cancellable at the next iteration
  boundary and write per-iteration history to `~/.hivemux/loops/<name>.jsonl`.
  New: `loop-list`, `loop-stop <name>`, `loop-log <name>`; daemon methods
  `loop_start` / `loop_stop` / `loop_list`.
- **Dashboard loop control** — start/stop a loop from the web GUI and see live loop
  state (iter/max/state) per agent. Endpoints `/api/loop/{start,stop,running}`.
- **MCP `stop_loop`** tool; `start_loop` is now tracked + cancellable.
- **Usage guide / runbook** (`docs/GUIDE.md`) — task-oriented recipes.
- More tests (runner adapters + loop registry) — 23 total.

## [1.2.0]

### Added
- **MCP server** (`hivemux mcp`, stdio JSON-RPC) — drive a hivemux fleet from any
  MCP client (Claude Code/Desktop, Cursor, …). A conductor agent spawns workers,
  starts verify→fix loops, watches status, merges the passes. 9 tools: `spawn_agent`,
  `start_loop` (fire-and-poll), `get_status`, `list_agents`, `usage`, `conflicts`,
  `merge`, `kill`, `broadcast`. Safety: mandatory per-agent cost cap, max-concurrent
  limit, `acceptEdits` (never skip-permissions).
- **Pluggable runners** — loops are no longer claude-only. `--runner <name>`;
  `claude` is built in (verified), others (codex, gemini, OpenRouter-backed CLIs)
  drop into `~/.hivemux/config.json` → `runners` (bin / args / parse).
- **macOS builds** — releases now also ship a `.dmg` and a `hivemux-macos-arm64`
  binary (alongside Linux AppImage/`.deb` and `hivemux-linux-x64`). The code was
  already portable (Bun + tmux + node: APIs).

## [1.1.1]

### Changed
- **Loop driver rebuilt to run agents headless** via `claude -p --output-format json`
  (one-shot per iteration) instead of typing into an interactive REPL + Stop hook.
  Robust (no REPL-readiness/TUI fragility, no hook), exact per-iteration cost from
  the JSON, context carried across iterations via `--resume`. **Validated live** on
  this repo — a real agent created and verified a file in one iteration ($0.24).

### Fixed
- Agents inheriting a depleted `ANTHROPIC_API_KEY` that shadows a working login —
  the loop runner unsets it before invoking the agent.

## [1.1.0]

### Added
- **Loop engineering** — `hivemux loop <name> --goal … --check "<cmd>" --max N`
  drives an agent through iterate → verify → fix cycles until the verifier passes
  or a stop condition hits (max iters / cost cap / context cap). On pass: optional
  `--commit` / `--pr`.
  - Verifier is a **shell check** (exit 0 = pass) or an **LLM judge** (`--rubric`).
  - **Fleet loops** (`--fleet N`): run the same goal on N isolated agents at once.
  - `--install-hook` writes a Claude Code Stop hook (`hivemux notify -s done`) so
    each agent turn signals completion and closes the loop.

### Changed
- **Renamed `amux` → `hivemux`** — the old name collided with an established
  127-star tool in the same niche (and npm). New repo, binary, state dir
  (`~/.hivemux`), env (`HIVEMUX_*`), and brand.

## [0.7.1]

### Added
- `hivemux prune` — remove agents whose tmux session is gone (`--rm-worktree` to drop
  their worktrees too). Surfaced by a dogfood pass that left an orphaned session.

### Verified
- The Claude Code transcript parser was validated against the real `~/.claude`
  JSONL format and directory layout (fields, cost math, context %).

## [0.7.0]

### Added
- **Observability**: `hivemux usage` — token counts, estimated cost, and
  context-window fill per agent, plus a total. Surfaced in the web dashboard
  (per-agent line + total). New `/api/usage` endpoint.
- **Multi-LLM, honest pricing**: built-in Anthropic rates are grounded; any
  other model/provider is config-driven via `~/.hivemux/config.json` → `pricing`.
  Unknown models show cost as "—" rather than a guessed number.
- **Two usage sources**: parse Claude Code's JSONL transcript (zero setup) or
  push from a hook via `hivemux report-usage` (agent-agnostic, any LLM).
- **Cost / context caps**: `hivemux new --cost-cap <usd> --ctx-cap <pct>`; crossing
  a cap fires a chime + toast + desktop notification and posts to Slack / a
  generic webhook (`~/.hivemux/config.json` → `integrations`).

## [0.6.0]

### Added
- Next-level GUI create-agent flow: **live repo validation** + branch preview
  (`GET /api/repo-check`), a **repo picker** (datalist of known repos), collapsible
  **advanced** branch/base, a real **creating-state** (spinner + await, no race),
  and inline name/duplicate validation.
- **Sound chimes** (Web Audio, synthesized) on agent waiting/done/error, with a
  persisted mute toggle.
- **Desktop notifications** on status changes (permission-gated).
- **Keyboard shortcuts** (`n` = new agent, `Esc` = close), Esc/click-out modal.
- **Toasts** for actions (create/merge/PR/broadcast/kill) replacing alerts;
  **waiting-count badge** in the window title.

## [0.5.0]

### Added
- **`hivemux gui`** — a cmux-style desktop app window: opens the dashboard chromeless
  (Chromium `--app`). New cmux-style layout: a sidebar of agent workspaces with
  status/notification rings + an **embedded live terminal** per agent (a `ttyd`
  serving `tmux attach`), and a toolbar (broadcast / merge / PR / kill).
- Web API: `GET /api/term/:name` (spawns a per-agent ttyd, returns its port),
  `POST /api/broadcast`, `POST /api/merge`, `POST /api/pr`.
- `core/terminals.ts` — on-demand ttyd lifecycle (loopback-bound, torn down on
  kill / server stop).
- **Desktop installers** — `electron/` packages the app as an AppImage + `.deb`
  (bundles `hivemux` + `ttyd`); a tagged release (`release.yml`) builds and publishes
  them to the GitHub Release.

## [0.4.0]

### Added
- `hivemux grid` — attach to a tiled, read-only live view of all agents. Each pane
  runs a `capture-pane` mirror loop (refreshes 1s), so the grid builds detached
  and renders correctly once attached.
- Web dashboard **create-agent form** — name + adapter (from `/api/agent-keys`) +
  repo path, POSTed to `/api/new`.
- Conflict count surfaced in the TUI header and the web header (not just the list).
- Branding: SVG logo + banner (`assets/`), README hero with badges, and a VHS
  tape (`demo/hivemux.tape`) to render the terminal demo GIF.

## [0.3.0]

### Added
- `hivemux broadcast [names...] -m "..."` — type the same prompt into many agents
  (all live agents if no names given).
- `hivemux merge <name> [--into b] [--ff]` — merge an agent's branch into the base
  branch; on conflict it collects the paths and `merge --abort`s, leaving the repo
  clean for the human to resolve.
- `hivemux pr <name> [-t title] [--draft]` — push the branch and open a GitHub PR via `gh`.
- **Web dashboard auth** — `--token` (or auto-minted when bound beyond loopback);
  enforced via `?token=` query or `x-hivemux-token` header, injected into the page.
- **CI** (`.github/workflows/ci.yml`): Bun setup → `bun run check` → build → binary smoke.
- Adopted cmux's TypeScript engineering standards: Biome (lint + format), strict
  tsconfig (`noUncheckedIndexedAccess`, `noFallthroughCasesInSwitch`,
  `forceConsistentCasingInFileNames`, `verbatimModuleSyntax`, `isolatedModules`).
- **Bun toolchain** to match cmux: `bun` runtime, `bun test` (+ unit test
  `core/agents.test.ts`), `bun build --compile` single standalone binary.
- `CONTRIBUTING.md`, `CHANGELOG.md`, `CLAUDE.md` (+ `AGENTS.md` symlink), and
  `docs/cmux-standards-review.md`.

### Changed
- Migrated off Node/`tsc`-build to Bun: `moduleResolution: bundler`, bare relative
  imports (stripped `.js` specifiers), shebang `#!/usr/bin/env bun`, dropped `tsx`.
- Lint-driven cleanups: template literals, optional chaining, guarded index access,
  early returns in the TUI key handler, removal of a non-null assertion.

## [0.2.0]

### Added
- `hivemux conflicts` — files changed by more than one agent in the same repo.
- `hivemux dash` — live full-screen TUI dashboard (zero-dep ANSI, SSH-safe).
- `hivemux web` — HTTP + SSE dashboard, standalone, remote-reachable.
- `hivemux daemon` / `hivemux watch` — Unix-socket control plane with event push.
- `core/watcher.ts` — shared poll loop consumed by daemon, TUI, and web.

### Changed
- Refactored to a layered architecture (`core/`, `ipc/`, `tui/`, `web/`).
- Concurrency-safe store: atomic writes + cross-process lock (fixes the
  read-modify-write race on concurrent `notify`).
- All tmux/git calls are async.

## [0.1.0]

### Added
- Initial MVP: `new`, `ls`, `attach`, `kill`, `notify`, `agents`.
- tmux-backed sessions, git-worktree isolation per agent, JSON registry.
