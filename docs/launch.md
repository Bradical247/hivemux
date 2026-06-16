# Launch notes

Distribution playbook for hivemux. v1.5.0 is published to npm, Homebrew, GitHub
Packages, and GitHub Releases. These channels drive discovery.

## Show HN

**Title** (<= 80 chars):

> Show HN: hivemux – run parallel AI coding agents in tmux (Linux, MCP-driven)

**URL:** https://github.com/Bradical247/hivemux

**Body:**

hivemux runs multiple AI coding agents (Claude Code, Codex, Gemini, Aider) in
parallel, each in its own git worktree and tmux session, managed from one place: a
CLI, a live TUI, a tiled web/desktop GUI, or a conductor agent over MCP.

It's built on tmux, so it runs headless over SSH, the agents survive disconnects,
and you can host them on a remote box and attach from anywhere. The GUI and web
dashboard are just frontends over the same tmux-backed core, so you get the GUI and
the server room.

What's in it:

- Parallel agents, isolated per git worktree (no file collisions)
- Loop engineering: iterate -> verify -> fix until a shell check or LLM judge passes,
  cost-capped, with `--fleet N` to race agents and `--watch` to see one reason live
- MCP server: a conductor agent spawns workers, starts loops, watches status, merges
- Sandbox + governance: OS sandbox (bwrap/seatbelt) per worktree, cost ceilings,
  hold-commit-for-approval
- Conflict detection, merge/PR orchestration, per-agent token/cost/context tracking
- One self-contained binary; `npm i -g hivemux`, `brew install bradical247/hivemux/hivemux`,
  or AppImage / .deb / .dmg

Built in TypeScript on Bun (Biome, strict tsconfig, unit + Playwright E2E in CI). MIT.

## First comment (post immediately after)

Author here. The design bet is "tmux as the substrate": hivemux doesn't reimplement
PTYs/sessions/persistence (tmux nails those), it adds the agent layer on top
(worktree isolation, status/notifications, conflict detection, usage/cost, the
verify->fix loop). That's why it's headless-and-remote-first. The loop engine is
audited against the 12-Factor Agents principles (docs/DESIGN-12factor.md).

Happy to answer anything about the architecture or the cost-tracking approach (it
parses each agent CLI's own transcript, or accepts pushed usage from a hook).

## HN status

Show HN is gated for new accounts (anti-spam). Plan: comment thoughtfully for a
week or two to build karma, then post. Use the no-gate channels below meanwhile.

## Channel 1: MCP directories (hivemux IS an MCP server; strongest hook)

- `punkpeye/awesome-mcp-servers` (PR)
- `modelcontextprotocol/servers` community list (PR)
- Auto-indexers (point them at the public repo): Glama, PulseMCP, Smithery, mcp.so

## Channel 2: awesome lists (evergreen, no gate, high leverage)

- `hesreallyhim/awesome-claude-code` (Claude Code is the default runner)
- `e2b-dev/awesome-ai-agents`
- `rothgar/awesome-tmux`
- `agarrharr/awesome-cli-apps`, `rothgar/awesome-tuis`

Entry line:

> **[hivemux](https://github.com/Bradical247/hivemux)** - Linux-native, tmux-backed
> orchestrator for parallel AI coding agents: isolated git worktrees, verify->fix
> loops, MCP control, conflict detection, merge/PR, usage/cost tracking; CLI + TUI +
> web/desktop GUI.

## Channel 3: X / Twitter (post the grid GIF)

> Built hivemux: run a swarm of AI coding agents (Claude Code, Codex, Gemini, Aider)
> on Linux, each in its own git worktree + tmux session.
>
> Headless over SSH, survives disconnects, GUI and the server room. Drive a fleet
> from a conductor agent over MCP. Loop until tests pass.
>
> MIT. npm i -g hivemux. https://github.com/Bradical247/hivemux

Attach `assets/gui-grid.gif` (three agents in parallel). Reply with `assets/demo.gif`.

## Channel 4: Reddit (frame as "I built", read each sub's self-promo rule first)

- **r/commandline**: lead with the CLI + tmux angle + the demo GIF.
- **r/selfhosted**: lead with headless/remote/SSH + web dashboard.
- **r/ClaudeAI** / **r/LocalLLaMA**: lead with parallel agents, MCP, cost tracking.
- **r/devops**: lead with the remote/headless fleet + sandbox/policy.

Reddit body:

> I kept wanting to run several coding agents at once without them clobbering each
> other, so I built hivemux: each agent gets its own git worktree + tmux session, and
> you drive them from a CLI, a live TUI, a web/desktop GUI, or a conductor agent over
> MCP. Because it's tmux-backed it runs headless over SSH and survives disconnects.
> A verify->fix loop iterates until your tests pass; it flags file conflicts before
> you merge and tracks per-agent token cost. MIT, `npm i -g hivemux`.
> Repo: https://github.com/Bradical247/hivemux (feedback welcome).

## Channel 5: package ecosystems

- npm: `hivemux` is live, discoverable via npm search + npmjs.com.
- Homebrew tap: `bradical247/homebrew-hivemux`.
- AUR (Arch): a `hivemux-bin` PKGBUILD pulling the release binary (Linux audience).
- Product Hunt: pick a launch day; lead with the grid GIF.
