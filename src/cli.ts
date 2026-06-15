#!/usr/bin/env bun
// Thin CLI frontend. All real work lives in core/manager. Normal commands run
// in-process (no daemon needed); `daemon` starts the control plane and `watch`
// streams live events from it.
import { Command } from "commander";
import * as mgr from "./core/manager";
import { attach } from "./core/tmux";
import type { AgentView, Status } from "./core/types";
import { DaemonClient } from "./ipc/client";
import { startDaemon } from "./ipc/server";

const program = new Command();
program
  .name("amux")
  .description("tmux-backed orchestrator for parallel AI coding agents")
  .version("0.3.0");

function fail(msg: string): never {
  console.error(`amux: ${msg}`);
  process.exit(1);
}

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    return fail((e as Error).message);
  }
}

program
  .command("new <name>")
  .description("spawn an agent in a fresh git worktree + tmux session")
  .option("-a, --agent <key>", "agent adapter to launch", "claude")
  .option("-r, --repo <path>", "repo to branch from (default: cwd)")
  .option("-b, --branch <branch>", "branch name (default: amux/<name>)")
  .option("--base <ref>", "base ref for the new branch")
  .action((name: string, opts) =>
    guard(async () => {
      const a = await mgr.create({
        name,
        agent: opts.agent,
        repo: opts.repo ?? process.cwd(),
        branch: opts.branch,
        base: opts.base,
      });
      console.log(
        `✓ '${a.name}' [${a.agent}] on ${a.branch}\n  ${a.worktree}\n  attach: amux attach ${a.name}`,
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
        console.log("no agents. start one: amux new <name>");
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
  .option("-n, --name <name>", "agent name (default: $AMUX_NAME)")
  .option("-s, --status <status>", "running | waiting | done | error", "waiting")
  .option("-m, --note <text>", "freeform note", "")
  .action((opts) =>
    guard(async () => {
      const name = opts.name ?? process.env.AMUX_NAME;
      if (!name) fail("no agent name (set $AMUX_NAME or pass --name)");
      await mgr.notify(name, opts.status as Status, opts.note);
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
  .command("dash")
  .description("live full-screen TUI dashboard")
  .action(() =>
    guard(async () => {
      const { runDash } = await import("./tui/dash");
      await runDash();
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
      console.log(`amux web → http://${opts.host}:${port}/${q}`);
      if (token) console.log(`  auth token: ${token}`);
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
      console.log(`amux daemon listening on ${SOCKET_PATH}`);
    }),
  );

program
  .command("watch")
  .description("stream live agent status from the daemon")
  .action(() =>
    guard(async () => {
      const client = await DaemonClient.tryConnect();
      if (!client) fail("daemon not running (start it: amux daemon)");
      await client.subscribe((e) => {
        const a = e.data as AgentView;
        console.log(`[${new Date().toLocaleTimeString()}] ${a.name}: ${a.status} ${a.note}`);
      });
      console.log("watching… (Ctrl-C to stop)");
    }),
  );

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

program.parseAsync(process.argv);
