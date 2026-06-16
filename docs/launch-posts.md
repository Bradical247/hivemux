# Ready-to-paste launch posts

Copy-paste. Plain text where the platform strips markdown (HN). Keep it honest, no
hype. Repo: https://github.com/Bradical247/hivemux

---

## Show HN

**Title** (62 chars, under the 80 limit):

```
Show HN: hivemux – run parallel AI coding agents in tmux (MCP)
```

**URL:**

```
https://github.com/Bradical247/hivemux
```

**Text** (HN strips most markdown; this is plain):

```
hivemux runs several AI coding agents (Claude Code, Codex, Gemini, Aider) in
parallel, each in its own git worktree and tmux session, and lets you manage them
from one place: a CLI, a live TUI, a tiled web/desktop GUI, or a conductor agent
over MCP.

The design bet is "tmux as the substrate." I didn't reimplement PTYs, sessions, or
persistence; tmux already nails those. hivemux adds the agent layer on top: worktree
isolation so agents don't clobber each other, a verify->fix loop that iterates until
your tests pass, conflict detection before you merge, and per-agent token/cost
tracking. Because it's tmux-backed, it runs headless over SSH, the agents survive
disconnects, and you can host them on a remote box and attach from anywhere.

The MCP server is the part I find most useful: point Claude Code (or any MCP client)
at it and a top-level agent can spawn workers, start loops, watch status and cost,
and merge the passes. Cost caps and a concurrency limit are on by default. Looped
agents run under an OS sandbox (bwrap/seatbelt) confined to their worktree, and a
policy can hold any commit/PR for approval.

It's a single self-contained binary (Bun-compiled). Install with `npm i -g hivemux`,
`brew install bradical247/hivemux/hivemux`, or grab an AppImage/.deb/.dmg. MIT.

It overlaps with cmux (macOS app) and amux (Go TUI); hivemux's niche is being
Linux-native, headless/remote-first, and MCP-driven, with the loop + sandbox layer.

Honest status: v1.5, young. Internals are tested (unit + a Playwright E2E of the GUI
in CI; the cost parser is checked against real Claude Code transcripts), but it
hasn't had many real users yet. Feedback very welcome, especially from people
already herding multiple agents.
```

**First comment** (post immediately, as the author):

```
Author here. A few things I'd genuinely like feedback on:

1. The loop verifier is either a shell command (exit 0 = pass) or an LLM judge with
a rubric. Curious which people reach for in practice.

2. Cost/usage is reconstructed two ways: parsing the agent CLI's own transcript, or
the agent self-reporting via a hook. The transcript path needs no setup but is
CLI-specific; the hook path is agent-agnostic. Open to better ideas.

3. It's agent-agnostic by config (any CLI that takes a prompt), but I've only
hardened the Claude Code path. Happy to take PRs / notes for codex/gemini/aider.

Architecture and the 12-Factor-Agents mapping are in the docs if you want the deep
end.
```

---

## Reddit

> Read each sub's self-promo rule first. Lead with the angle that sub cares about,
> link once, ask for feedback. Don't cross-post the same text same-day.

### r/commandline

**Title:** `I built hivemux: run parallel AI coding agents, each in its own tmux session + git worktree`

```
I kept wanting to run several coding agents at once without them clobbering each
other, so I built hivemux. Each agent gets its own git worktree (own branch, no file
collisions) and its own tmux session, and you drive the whole fleet from the CLI: new,
ls, attach, loop, merge, broadcast, usage. There's also a live TUI and a tiled view.

Because it's tmux-backed it runs headless over SSH and survives disconnects, so you
can park a fleet on a remote box and reattach later. A verify->fix loop iterates an
agent until a shell check passes, and it flags file conflicts before you merge.

Single self-contained binary. `npm i -g hivemux` or `brew install bradical247/hivemux/hivemux`.
MIT. Repo: https://github.com/Bradical247/hivemux  - feedback very welcome.
```

### r/selfhosted

**Title:** `hivemux: self-host a fleet of AI coding agents on a box, drive it from a web dashboard`

```
hivemux runs multiple AI coding agents in parallel on a single host, each isolated
in its own git worktree + tmux session. It's tmux-backed, so it's headless and
remote-first: run it on a server over SSH, agents survive disconnects, and you reach
it from a web dashboard (SSE live updates, auto-minted auth token when it binds
beyond loopback) or a cmux-style desktop window.

Looped agents run under an OS sandbox confined to their worktree, with hard cost
ceilings and an optional approve-before-commit gate. Single binary, no runtime to
install on the host. MIT.

https://github.com/Bradical247/hivemux  - would love feedback from anyone running
agents on their own hardware.
```

### r/ClaudeAI

**Title:** `Built an MCP server that lets Claude Code orchestrate a fleet of Claude Code agents`

```
hivemux exposes a fleet of coding agents as MCP tools, so a top-level Claude Code (or
Claude Desktop) can spawn workers, start verify->fix loops, watch status + cost, and
merge the passes, all conversationally: "fan out 3 agents on these bugs, loop each
until tests pass, $3 cap, merge the greens."

Each worker is isolated in its own git worktree + tmux session. Cost caps and a
concurrency limit are on by default; you can sandbox agents to their worktree and
hold commits for approval. Per-agent token/cost/context is tracked by parsing Claude
Code's own transcript.

Single binary, `npm i -g hivemux`, MIT. https://github.com/Bradical247/hivemux  -
feedback welcome, especially on the MCP tool surface.
```

### r/LocalLLaMA

**Title:** `hivemux: run parallel coding agents (any CLI) in tmux, with per-agent cost tracking`

```
hivemux orchestrates multiple coding-agent CLIs in parallel, each in its own git
worktree + tmux session. It's agent-agnostic: Claude Code is built in, and codex /
gemini / aider / any prompt-taking CLI drop in via config (so you can point it at a
local-model CLI too). A verify->fix loop iterates until a shell check or an LLM judge
passes, cost-capped.

Pricing is configurable per model (Anthropic rates ship built in), so you get
per-agent token + cost + context-window tracking across whatever you run. Headless
over SSH, single binary, MIT.

https://github.com/Bradical247/hivemux  - curious what people pair it with locally.
```

### r/devops

**Title:** `hivemux: a headless, remote-first orchestrator for parallel AI coding agents (tmux + git worktrees)`

```
hivemux runs a fleet of coding agents on a box, each in its own git worktree + tmux
session, managed over a CLI, a daemon with an event-push API, or MCP. It's built on
tmux, so it's headless and survives disconnects: spin it up on a server, walk away,
reattach.

The bits relevant here: OS-level sandboxing (bwrap/seatbelt) confining each agent to
its worktree, a governance policy (sandbox/network/cost ceiling/approval gate), a
verify->fix loop with cost caps, conflict detection before merge, and Slack/webhook
alerts on cost/context thresholds. Single self-contained binary. MIT.

https://github.com/Bradical247/hivemux  - feedback welcome.
```

---

## X / Twitter

Attach `assets/gui-grid.gif` (three agents in parallel); reply with `assets/demo.gif`.

```
Built hivemux: run a swarm of AI coding agents (Claude Code, Codex, Gemini, Aider)
on Linux, each in its own git worktree + tmux session.

Headless over SSH, survives disconnects. Drive a fleet from a conductor agent over
MCP. Loop until tests pass.

MIT. npm i -g hivemux
https://github.com/Bradical247/hivemux
```
