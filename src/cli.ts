#!/usr/bin/env bun
// Thin CLI frontend. All real work lives in core/manager. Normal commands run
// in-process (no daemon needed); `daemon` starts the control plane and `watch`
// streams live events from it.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { agentKeys } from "./core/agents";
import { isRepo } from "./core/git";
import * as mgr from "./core/manager";
import { loadPolicy } from "./core/policy";
import { resolveRunner } from "./core/runners";
import { sandboxKind } from "./core/sandbox";
import { attach } from "./core/tmux";
import type { AgentView, Status } from "./core/types";
import { DaemonClient } from "./ipc/client";
import { startDaemon } from "./ipc/server";

const VERSION = "1.6.0";

/** ASCII honeycomb mark. Green only when stdout is a TTY (keeps pipes clean). */
function banner(): string {
  const tty = process.stdout.isTTY;
  const g = tty ? "\x1b[38;5;71m" : "";
  const b = tty ? "\x1b[1m" : "";
  const r = tty ? "\x1b[0m" : "";
  const d = tty ? "\x1b[2m" : "";
  return [
    `${g}   __    __${r}`,
    `${g}  /  \\__/  \\${r}    ${b}hivemux${r} ${d}v${VERSION}${r}`,
    `${g}  \\__/  \\__/${r}    ${d}tmux-backed orchestrator${r}`,
    `${g}  /  \\__/  \\${r}    ${d}for parallel AI coding agents${r}`,
    `${g}  \\__/  \\__/${r}`,
    "",
  ].join("\n");
}

const program = new Command();
program
  .name("hivemux")
  .description("tmux-backed orchestrator for parallel AI coding agents")
  .version(VERSION);
program.addHelpText("beforeAll", banner());

function fail(msg: string): never {
  console.error(`hivemux: ${msg}`);
  process.exit(1);
}

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    return fail((e as Error).message);
  }
}

/** First installed Chromium-family browser that supports `--app` window mode. */
function findBrowser(): string | null {
  const candidates = [
    "chromium",
    "chromium-browser",
    "google-chrome",
    "google-chrome-stable",
    "brave-browser",
    "microsoft-edge",
  ];
  for (const c of candidates) {
    try {
      if (spawnSync(c, ["--version"], { stdio: "ignore" }).status === 0) return c;
    } catch {
      /* not installed */
    }
  }
  return null;
}

program
  .command("new <name>")
  .description("spawn an agent in a fresh git worktree + tmux session")
  .option("-a, --agent <key>", "agent adapter to launch", "claude")
  .option("-r, --repo <path>", "repo to branch from (default: cwd)")
  .option("-b, --branch <branch>", "branch name (default: hivemux/<name>)")
  .option("--base <ref>", "base ref for the new branch")
  .option("--no-init", "fail instead of git-init when the folder isn't a repo")
  .option("--cost-cap <usd>", "alert when estimated cost crosses this (USD)")
  .option("--ctx-cap <pct>", "alert when context fill crosses this (%)")
  .action((name: string, opts) =>
    guard(async () => {
      const repo = opts.repo ?? process.cwd();
      if (opts.init !== false && !(await isRepo(repo))) {
        console.log(`no git repo at ${repo}; initializing a fresh one`);
      }
      const a = await mgr.create({
        name,
        agent: opts.agent,
        repo,
        branch: opts.branch,
        base: opts.base,
        init: opts.init,
        costCap: opts.costCap ? Number(opts.costCap) : undefined,
        ctxCap: opts.ctxCap ? Number(opts.ctxCap) : undefined,
      });
      console.log(
        `✓ '${a.name}' [${a.agent}] on ${a.branch}\n  ${a.worktree}\n  attach: hivemux attach ${a.name}`,
      );
    }),
  );

program
  .command("ls")
  .alias("list")
  .description("list agents and their status")
  .action(() =>
    guard(async () => {
      const agents = await mgr.list();
      if (agents.length === 0) {
        console.log("no agents. start one: hivemux new <name>");
        return;
      }
      printTable(agents);
    }),
  );

program
  .command("attach <name>")
  .description("attach to an agent's tmux session")
  .action((name: string) =>
    guard(async () => {
      const a = await mgr.get(name);
      if (!a) fail(`unknown agent '${name}'`);
      if (!a.alive) fail(`session for '${name}' is dead`);
      attach(a.session);
    }),
  );

program
  .command("kill <name>")
  .description("kill an agent's session and deregister it")
  .option("--rm-worktree", "also remove the git worktree")
  .action((name: string, opts) =>
    guard(async () => {
      await mgr.kill(name, Boolean(opts.rmWorktree));
      console.log(`✓ killed '${name}'`);
    }),
  );

program
  .command("notify")
  .description("report status for an agent (call from agent hooks)")
  .option("-n, --name <name>", "agent name (default: $HIVEMUX_NAME)")
  .option("-s, --status <status>", "running | waiting | done | error", "waiting")
  .option("-m, --note <text>", "freeform note", "")
  .action((opts) =>
    guard(async () => {
      const name = opts.name ?? process.env.HIVEMUX_NAME;
      if (!name) fail("no agent name (set $HIVEMUX_NAME or pass --name)");
      await mgr.notify(name, opts.status as Status, opts.note);
    }),
  );

program
  .command("prune")
  .description("remove agents whose tmux session is gone")
  .option("--rm-worktree", "also remove their git worktrees")
  .action((opts) =>
    guard(async () => {
      const removed = await mgr.prune(Boolean(opts.rmWorktree));
      console.log(removed.length ? `✓ pruned: ${removed.join(", ")}` : "nothing to prune");
    }),
  );

program
  .command("conflicts")
  .description("show files changed by more than one agent (merge collisions)")
  .action(() =>
    guard(async () => {
      const cs = await mgr.conflicts();
      if (cs.length === 0) {
        console.log("no conflicts");
        return;
      }
      for (const c of cs) console.log(`⚠ ${c.file}\n   ← ${c.agents.join(", ")}`);
    }),
  );

program
  .command("broadcast [names...]")
  .description("send a prompt to agents' sessions (no names = all live agents)")
  .requiredOption("-m, --message <text>", "text to type into each session")
  .action((names: string[], opts) =>
    guard(async () => {
      const sent = await mgr.broadcast(names, opts.message);
      console.log(sent.length ? `✓ sent to: ${sent.join(", ")}` : "no live agents to send to");
    }),
  );

program
  .command("pr <name>")
  .description("push the agent's branch and open a GitHub PR (needs gh)")
  .option("-t, --title <title>", "PR title (default: branch name)")
  .option("--body <text>", "PR body")
  .option("--draft", "open as a draft PR")
  .action((name: string, opts) =>
    guard(async () => {
      const url = await mgr.openPr(name, {
        title: opts.title,
        body: opts.body,
        draft: Boolean(opts.draft),
      });
      console.log(`✓ ${url}`);
    }),
  );

program
  .command("merge <name>")
  .description("merge an agent's branch into the base branch")
  .option("--into <branch>", "target branch (default: repo's integration branch)")
  .option("--ff", "allow fast-forward merge (default: --no-ff)")
  .action((name: string, opts) =>
    guard(async () => {
      const r = await mgr.merge(name, { into: opts.into, noFf: !opts.ff });
      if (r.merged) {
        console.log(`✓ merged '${name}' into ${r.into}`);
        return;
      }
      console.error(`✗ merge into ${r.into} hit conflicts (aborted — repo left clean):`);
      for (const f of r.conflicts) console.error(`   ${f}`);
      process.exit(1);
    }),
  );

program
  .command("loop <name>")
  .description("iterate an agent until a verifier passes (loop engineering)")
  .requiredOption("-g, --goal <text>", "what the agent should achieve")
  .option("--check <cmd>", "shell verifier — exit 0 = pass")
  .option("--rubric <text>", "LLM-judge criteria (used when no --check)")
  .option("--max <n>", "max iterations", "10")
  .option("--runner <name>", "agent runner: claude (default) or a configured one", "claude")
  .option("--commit", "git commit on pass")
  .option("--pr", "open a GitHub PR on pass (needs gh)")
  .option("--fleet <n>", "run the same goal on N agents (name = base)")
  .option("--detach", "run via the daemon so it survives disconnect")
  .option("--ponytail", "lazy-senior-dev mode: bias the agent toward the smallest solution")
  .option("--sandbox <mode>", "OS sandbox for the agent: auto | on | off (default: policy)")
  .option("--watch", "stream the agent's output (incl. thinking) into its terminal pane")
  .option("-a, --agent <key>", "agent adapter for --fleet", "claude")
  .option("-r, --repo <path>", "repo for --fleet (default: cwd)")
  .action((name: string, opts) =>
    guard(async () => {
      const spec = {
        goal: opts.goal,
        check: opts.check,
        rubric: opts.rubric,
        maxIters: Number(opts.max),
        runner: opts.runner,
        ponytail: Boolean(opts.ponytail),
        sandbox: ["auto", "on", "off"].includes(opts.sandbox) ? opts.sandbox : undefined,
        watch: Boolean(opts.watch),
      };
      if (!spec.check && !spec.rubric) fail("need --check <cmd> or --rubric <text>");
      const lopts = {
        commit: Boolean(opts.commit),
        pr: Boolean(opts.pr),
      };
      const log = (m: string) => console.log(m);
      if (opts.detach) {
        const client = await DaemonClient.tryConnect();
        if (!client) fail("--detach needs the daemon running: start it with `hivemux daemon`");
        await client.call("loop_start", { name, spec, opts: lopts });
        console.log(
          `✓ loop '${name}' started in the daemon — hivemux loop-list / loop-log ${name}`,
        );
        return;
      }
      if (opts.fleet) {
        const res = await mgr.fleetLoop(
          name,
          Number(opts.fleet),
          opts.agent,
          opts.repo ?? process.cwd(),
          spec,
          lopts,
          log,
        );
        for (const r of res) {
          console.log(
            `${r.name}: ${r.result.passed ? "✓ passed" : `✗ ${r.result.reason}`} (${r.result.iters} iters)`,
          );
        }
        return;
      }
      const r = await mgr.loop(name, spec, lopts, log);
      console.log(
        r.passed
          ? `✓ '${name}' passed in ${r.iters} iters`
          : `✗ '${name}' stopped: ${r.reason} (${r.iters} iters)`,
      );
      if (!r.passed) process.exit(1);
    }),
  );

program
  .command("loop-stop <name>")
  .description("cancel a running loop (next iteration boundary)")
  .action((name: string) =>
    guard(async () => {
      const client = await DaemonClient.tryConnect();
      const stopped = client
        ? ((await client.call("loop_stop", { name })) as { stopped: boolean }).stopped
        : mgr.stopLoop(name);
      console.log(stopped ? `✓ stopping '${name}'` : `no running loop '${name}'`);
    }),
  );

program
  .command("loop-list")
  .description("list running loops")
  .action(() =>
    guard(async () => {
      const client = await DaemonClient.tryConnect();
      const names = client ? ((await client.call("loop_list")) as string[]) : mgr.runningLoops();
      console.log(names.length ? names.join("\n") : "no running loops");
    }),
  );

program
  .command("loop-log <name>")
  .description("show a loop's per-iteration history")
  .action((name: string) =>
    guard(async () => {
      const recs = await mgr.loopHistory(name);
      if (recs.length === 0) {
        console.log("no history");
        return;
      }
      for (const r of recs) console.log(JSON.stringify(r));
    }),
  );

program
  .command("approve [name]")
  .description("approve a commit/PR held by the requireApproval policy (no name = list)")
  .action((name?: string) =>
    guard(async () => {
      if (!name) {
        const p = await mgr.listPending();
        console.log(p.length ? `pending approval: ${p.join(", ")}` : "nothing pending");
        return;
      }
      const r = await mgr.approve(name);
      console.log(
        `✓ approved '${name}'${r.committed ? " (committed)" : ""}${r.pr ? ` PR: ${r.pr}` : ""}`,
      );
    }),
  );

program
  .command("deny <name>")
  .description("discard a commit/PR held for approval")
  .action((name: string) =>
    guard(async () => {
      await mgr.denyApproval(name);
      console.log(`✓ denied '${name}'`);
    }),
  );

program
  .command("doctor")
  .description("check hivemux's runtime dependencies + sandbox availability")
  .action(() =>
    guard(async () => {
      await runDoctor();
    }),
  );

program
  .command("dash")
  .description("live full-screen TUI dashboard")
  .action(() =>
    guard(async () => {
      const { runDash } = await import("./tui/dash");
      await runDash();
    }),
  );

program
  .command("grid")
  .description("attach to a tiled, read-only view of all live agents")
  .action(() =>
    guard(async () => {
      const n = await mgr.grid();
      if (n === 0) {
        console.log("no live agents to tile");
        return;
      }
      attach(mgr.GRID_SESSION);
    }),
  );

program
  .command("web")
  .description("serve the web dashboard")
  .option("-p, --port <port>", "port", "7878")
  .option("--host <host>", "bind host (0.0.0.0 to expose)", "127.0.0.1")
  .option("--token <token>", "require this bearer token (auto-generated if exposed)")
  .action((opts) =>
    guard(async () => {
      const { startWeb } = await import("./web/server");
      const port = Number(opts.port);
      const { token } = await startWeb(port, opts.host, opts.token);
      const q = token ? `?token=${token}` : "";
      console.log(`hivemux web → http://${opts.host}:${port}/${q}`);
      if (token) console.log(`  auth token: ${token}`);
    }),
  );

/** Start the web server and open it as a desktop app window. */
async function launchGui(port: number): Promise<void> {
  const { startWeb } = await import("./web/server");
  await startWeb(port, "127.0.0.1");
  const url = `http://127.0.0.1:${port}/`;
  const browser = findBrowser();
  if (browser) {
    spawn(browser, [`--app=${url}`, "--new-window"], {
      detached: true,
      stdio: "ignore",
    }).unref();
    console.log(`hivemux gui → ${url}  (app window via ${browser})`);
  } else {
    console.log(`hivemux gui → open ${url}  (no Chromium/Chrome found for app mode)`);
  }
  console.log("  embedded terminals require ttyd on PATH");
}

program
  .command("gui")
  .description("open the dashboard as a desktop app window (cmux-style) [default]")
  .option("-p, --port <port>", "port", "7878")
  .action((opts) => guard(() => launchGui(Number(opts.port))));

program
  .command("mcp")
  .description("run hivemux as an MCP server (stdio) so a conductor agent can drive a fleet")
  .action(() =>
    guard(async () => {
      const { runMcp } = await import("./ipc/mcp");
      await runMcp();
    }),
  );

program
  .command("usage")
  .description("token usage, estimated cost, and context fill per agent")
  .option("--json", "output JSON")
  .action((opts) =>
    guard(async () => {
      const rows = await mgr.usageAll();
      if (opts.json) {
        console.log(JSON.stringify(rows, null, 2));
        return;
      }
      if (rows.length === 0) {
        console.log("no agents");
        return;
      }
      let total = 0;
      for (const r of rows) {
        const u = r.usageView;
        if (u.costUSD != null) total += u.costUSD;
        const cost = u.costUSD != null ? `$${u.costUSD.toFixed(4)}` : "—";
        const ctx = u.ctxPct != null ? `${u.ctxPct}%` : "—";
        const flags = `${r.overCost ? " ⚠$" : ""}${r.overCtx ? " ⚠ctx" : ""}`;
        console.log(
          `${r.name.padEnd(16)} ${(u.model || "?").padEnd(20)} in:${u.inTok} out:${u.outTok} ctx:${ctx} ${cost} [${u.source}]${flags}`,
        );
      }
      console.log(`\ntotal estimated cost: $${total.toFixed(4)}`);
    }),
  );

program
  .command("report-usage")
  .description("record an agent's token usage (call from agent hooks)")
  .option("-n, --name <name>", "agent name (default: $HIVEMUX_NAME)")
  .option("-m, --model <model>", "model id (for cost lookup)")
  .option("--in <n>", "input tokens", "0")
  .option("--out <n>", "output tokens", "0")
  .option("--cache-read <n>", "cache-read tokens", "0")
  .option("--cache-write <n>", "cache-write tokens", "0")
  .option("--ctx <n>", "current context tokens", "0")
  .action((opts) =>
    guard(async () => {
      const name = opts.name ?? process.env.HIVEMUX_NAME;
      if (!name) fail("no agent name (set $HIVEMUX_NAME or pass --name)");
      await mgr.reportUsage(
        name,
        {
          inTok: Number(opts.in),
          outTok: Number(opts.out),
          cacheRead: Number(opts.cacheRead),
          cacheWrite: Number(opts.cacheWrite),
        },
        opts.model,
        Number(opts.ctx) || undefined,
      );
    }),
  );

program
  .command("agents")
  .description("list available agent adapters")
  .action(() =>
    guard(async () => {
      console.log((await mgr.agentKeys()).join("\n"));
    }),
  );

program
  .command("daemon")
  .description("run the control-plane daemon (event push + remote/web API)")
  .action(() =>
    guard(async () => {
      const { SOCKET_PATH } = await import("./ipc/protocol");
      await startDaemon();
      console.log(`hivemux daemon listening on ${SOCKET_PATH}`);
    }),
  );

program
  .command("watch")
  .description("stream live agent status from the daemon")
  .action(() =>
    guard(async () => {
      const client = await DaemonClient.tryConnect();
      if (!client) fail("daemon not running (start it: hivemux daemon)");
      await client.subscribe((e) => {
        const a = e.data as AgentView;
        console.log(`[${new Date().toLocaleTimeString()}] ${a.name}: ${a.status} ${a.note}`);
      });
      console.log("watching… (Ctrl-C to stop)");
    }),
  );

function onPath(bin: string): boolean {
  return (process.env.PATH ?? "").split(":").some((d) => d && existsSync(path.join(d, bin)));
}

async function runDoctor(): Promise<void> {
  const mark = (ok: boolean) => (ok ? "✓" : "✗");
  const line = (ok: boolean, label: string, note = "") =>
    console.log(`  ${mark(ok)} ${label}${note ? `  ${note}` : ""}`);

  console.log("required");
  line(onPath("tmux"), "tmux", "agent sessions");
  line(onPath("git"), "git", "worktrees");

  console.log("desktop GUI (hivemux gui / web terminals)");
  line(onPath("ttyd"), "ttyd", "embedded terminals");
  const browser = ["google-chrome", "chromium", "chromium-browser", "brave-browser"].find(onPath);
  line(Boolean(browser), "chromium-family browser", browser ?? "for --app window");

  console.log("optional");
  line(onPath("gh"), "gh", "hivemux pr");
  line(onPath("node"), "node", "some agent CLIs");

  console.log("sandbox (loop confinement)");
  const kind = sandboxKind();
  line(
    kind !== "none",
    `sandbox: ${kind}`,
    kind === "none" ? "install bwrap (Linux) for --sandbox" : "",
  );
  const pol = loadPolicy();
  console.log(
    `  policy: sandbox=${pol.sandbox} network=${pol.network} requireApproval=${pol.requireApproval}${pol.maxCostUSD != null ? ` maxCostUSD=${pol.maxCostUSD}` : ""}`,
  );

  console.log("runners");
  for (const key of await agentKeys()) {
    if (key === "shell") continue; // an interactive shell, not a headless runner
    const bin = resolveRunner(key).bin;
    if (!bin) continue;
    line(onPath(bin), key, bin);
  }
}

function printTable(agents: AgentView[]): void {
  const cols: Array<[string, (a: AgentView) => string]> = [
    ["NAME", (a) => a.name],
    ["STATUS", (a) => a.status],
    ["AGENT", (a) => a.agent],
    ["BRANCH", (a) => a.branch],
    ["NOTE", (a) => a.note],
  ];
  const widths = cols.map(([h, f]) => Math.max(h.length, ...agents.map((a) => f(a).length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join("  ");
  console.log(line(cols.map(([h]) => h)));
  for (const a of agents) console.log(line(cols.map(([, f]) => f(a))));
}

// Bare `hivemux` (no subcommand) launches the GUI. `hivemux --help` / `-h` still
// shows help; every subcommand still works.
if (process.argv.length <= 2) {
  guard(() => launchGui(7878));
} else {
  program.parseAsync(process.argv);
}
