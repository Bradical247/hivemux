# Changelog

All notable changes to amux are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions are semver.

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
