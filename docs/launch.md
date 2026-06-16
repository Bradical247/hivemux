# Launch notes

## Show HN

**Title** (≤ 80 chars):

> Show HN: amux – cmux for Linux, run parallel AI coding agents in tmux

**URL:** https://github.com/Bradical247/amux

**Body:**

amux runs multiple AI coding agents (Claude Code, Codex, Gemini, Aider) in
parallel — each in its own git worktree and tmux session — and manages them from
one place: a CLI, a live TUI, a tiled view, a web dashboard, and a cmux-style
desktop app.

It's inspired by cmux (manaflow-ai/cmux), which is a polished native macOS app.
amux takes the opposite bet: because it's built on tmux, it runs **headless over
SSH**, the agents **survive disconnects**, and you can host them on a remote box
and attach from anywhere — which a desktop GUI can't do. The desktop app and web
dashboard are just frontends over the same tmux-backed core, so you get the GUI
*and* the server room.

What's in it:

- Parallel agents, isolated per git worktree (no file collisions)
- Conflict detection (flags files >1 agent touched, before you merge)
- Merge / PR orchestration, broadcast a prompt to N agents
- Usage observability: per-agent tokens, estimated cost, context-window fill
  (Anthropic rates built in; any other model via config). Cost/context caps with
  Slack/webhook alerts.
- Ships as a single self-contained binary, plus AppImage / .deb installers

Built in TypeScript on Bun, following cmux's own engineering standards (Biome,
strict tsconfig). MIT.

Honest status: v1.0, but young — I've verified the internals (incl. the
token/cost parser against real Claude Code transcripts) but it hasn't had real
users yet. Feedback very welcome, especially from people already herding multiple
agents.

## First comment (post immediately after)

Author here. The design bet is "tmux as the substrate": amux doesn't reimplement
PTYs/sessions/persistence — tmux already nails those — it adds the agent layer on
top (worktree isolation, status/notifications, conflict detection, usage/cost).
That's why it's headless-and-remote-first instead of a desktop app.

Happy to answer anything about the architecture or the cost-tracking approach
(it parses each agent CLI's own transcript, or accepts pushed usage from a hook).

## Other channels
- r/commandline, r/Anthropic, r/ClaudeAI
- X/Twitter with the demo GIF (assets/demo.gif) and the social card (assets/social.png)
