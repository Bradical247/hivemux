# Changelog

All notable changes to amux are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions are semver.

## [0.7.0]

### Added
- **Observability**: `amux usage` — token counts, estimated cost, and
  context-window fill per agent, plus a total. Surfaced in the web dashboard
  (per-agent line + total). New `/api/usage` endpoint.
- **Multi-LLM, honest pricing**: built-in Anthropic rates are grounded; any
  other model/provider is config-driven via `~/.amux/config.json` → `pricing`.
  Unknown models show cost as "—" rather than a guessed number.
- **Two usage sources**: parse Claude Code's JSONL transcript (zero setup) or
  push from a hook via `amux report-usage` (agent-agnostic, any LLM).
- **Cost / context caps**: `amux new --cost-cap <usd> --ctx-cap <pct>`; crossing
  a cap fires a chime + toast + desktop notification and posts to Slack / a
  generic webhook (`~/.amux/config.json` → `integrations`).

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
- **`amux gui`** — a cmux-style desktop app window: opens the dashboard chromeless
  (Chromium `--app`). New cmux-style layout: a sidebar of agent workspaces with
  status/notification rings + an **embedded live terminal** per agent (a `ttyd`
  serving `tmux attach`), and a toolbar (broadcast / merge / PR / kill).
- Web API: `GET /api/term/:name` (spawns a per-agent ttyd, returns its port),
  `POST /api/broadcast`, `POST /api/merge`, `POST /api/pr`.
- `core/terminals.ts` — on-demand ttyd lifecycle (loopback-bound, torn down on
  kill / server stop).
- **Desktop installers** — `electron/` packages the app as an AppImage + `.deb`
  (bundles `amux` + `ttyd`); a tagged release (`release.yml`) builds and publishes
  them to the GitHub Release.

## [0.4.0]

### Added
- `amux grid` — attach to a tiled, read-only live view of all agents. Each pane
  runs a `capture-pane` mirror loop (refreshes 1s), so the grid builds detached
  and renders correctly once attached.
- Web dashboard **create-agent form** — name + adapter (from `/api/agent-keys`) +
  repo path, POSTed to `/api/new`.
- Conflict count surfaced in the TUI header and the web header (not just the list).
- Branding: SVG logo + banner (`assets/`), README hero with badges, and a VHS
  tape (`demo/amux.tape`) to render the terminal demo GIF.

## [0.3.0]

### Added
- `amux broadcast [names...] -m "..."` — type the same prompt into many agents
  (all live agents if no names given).
- `amux merge <name> [--into b] [--ff]` — merge an agent's branch into the base
  branch; on conflict it collects the paths and `merge --abort`s, leaving the repo
  clean for the human to resolve.
- `amux pr <name> [-t title] [--draft]` — push the branch and open a GitHub PR via `gh`.
- **Web dashboard auth** — `--token` (or auto-minted when bound beyond loopback);
  enforced via `?token=` query or `x-amux-token` header, injected into the page.
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
- `amux conflicts` — files changed by more than one agent in the same repo.
- `amux dash` — live full-screen TUI dashboard (zero-dep ANSI, SSH-safe).
- `amux web` — HTTP + SSE dashboard, standalone, remote-reachable.
- `amux daemon` / `amux watch` — Unix-socket control plane with event push.
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
