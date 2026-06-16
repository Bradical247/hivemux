// The orchestration core. Every frontend — CLI, daemon/IPC, future TUI and web —
// calls these functions. No frontend talks to tmux/git/store directly, so there
// is exactly one source of truth and one place to evolve behavior.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { agentKeys as _agentKeys, resolveAgent } from "./agents";
import {
  addWorktree,
  changedFiles,
  commitAll,
  createPR,
  currentBranch,
  defaultBranch,
  ghAvailable,
  type MergeResult,
  mergeInto,
  pushBranch,
  removeWorktree,
  repoName,
  repoRoot,
} from "./git";
import { type LoopResult, type LoopSpec, runLoop } from "./loop";
import type { RawUsage } from "./pricing";
import * as store from "./store";
import { buildGrid, killSession, newSession, sendKeys, sessionExists } from "./tmux";
import type { Agent, AgentView, Conflict, NewAgentOpts, UsageView } from "./types";
import { agentUsage } from "./usage";

export class AmuxError extends Error {}

function sessionName(name: string): string {
  return `hivemux-${name}`;
}

/** All agents enriched with live tmux liveness; dead sessions reported as "dead". */
export async function list(): Promise<AgentView[]> {
  const agents = await store.getAll();
  return Promise.all(
    agents.map(async (a) => {
      const alive = await sessionExists(a.session);
      return { ...a, alive, status: alive ? a.status : "dead" };
    }),
  );
}

export async function get(name: string): Promise<AgentView | undefined> {
  const a = await store.get(name);
  if (!a) return undefined;
  const alive = await sessionExists(a.session);
  return { ...a, alive, status: alive ? a.status : "dead" };
}

export async function create(opts: NewAgentOpts): Promise<Agent> {
  if (await store.get(opts.name)) throw new AmuxError(`agent '${opts.name}' already exists`);
  const session = sessionName(opts.name);
  if (await sessionExists(session)) throw new AmuxError(`tmux session '${session}' already exists`);

  let root: string;
  try {
    root = await repoRoot(opts.repo);
  } catch {
    throw new AmuxError("not inside a git repo (use --repo)");
  }

  const branch = opts.branch ?? `hivemux/${opts.name}`;
  const def = await resolveAgent(opts.agent);
  const worktree = await addWorktree(root, opts.name, branch, opts.base);

  await newSession(session, worktree, { HIVEMUX_NAME: opts.name }, def.cmd);
  const agent: Agent = {
    name: opts.name,
    repo: root,
    worktree,
    branch,
    session,
    agent: opts.agent,
    cmd: def.cmd,
    createdAt: new Date().toISOString(),
    status: "running",
    note: "",
    costCap: opts.costCap,
    ctxCap: opts.ctxCap,
  };
  await store.put(agent);
  return agent;
}

/** Remove agents whose tmux session is gone (optionally their worktrees too). */
export async function prune(rmWorktree = false): Promise<string[]> {
  const dead = (await list()).filter((v) => !v.alive);
  for (const d of dead) {
    if (rmWorktree) await removeWorktree(d.repo, d.worktree).catch(() => {});
    await store.remove(d.name);
  }
  return dead.map((d) => d.name);
}

export async function kill(name: string, rmWorktree = false): Promise<void> {
  const a = await store.get(name);
  if (!a) throw new AmuxError(`unknown agent '${name}'`);
  await killSession(a.session);
  if (rmWorktree) {
    await removeWorktree(a.repo, a.worktree).catch(() => {
      /* worktree may already be gone; deregister regardless */
    });
  }
  await store.remove(name);
}

export async function notify(name: string, status: Agent["status"], note = ""): Promise<void> {
  if (!(await store.get(name))) throw new AmuxError(`unknown agent '${name}'`);
  await store.update(name, { status, note });
}

export async function agentKeys(): Promise<string[]> {
  return _agentKeys();
}

/**
 * Files modified by more than one agent within the same repo — i.e. branches
 * that will collide on merge. Computed live from each worktree's working tree.
 */
export async function conflicts(): Promise<Conflict[]> {
  const agents = await store.getAll();
  // repo+file -> set of agent names touching it
  const map = new Map<string, { repo: string; file: string; agents: Set<string> }>();
  await Promise.all(
    agents.map(async (a) => {
      for (const file of await changedFiles(a.worktree)) {
        const key = `${a.repo}\0${file}`;
        let e = map.get(key);
        if (!e) {
          e = { repo: a.repo, file, agents: new Set() };
          map.set(key, e);
        }
        e.agents.add(a.name);
      }
    }),
  );
  return [...map.values()]
    .filter((e) => e.agents.size > 1)
    .map((e) => ({ repo: e.repo, file: e.file, agents: [...e.agents].sort() }));
}

/**
 * Send the same text to one or more agents' sessions (empty list = all live
 * agents). Dead sessions are skipped. Returns the names actually delivered to.
 */
export async function broadcast(names: string[], text: string): Promise<string[]> {
  const targets = names.length ? names : (await store.getAll()).map((a) => a.name);
  const sent: string[] = [];
  for (const name of targets) {
    const a = await store.get(name);
    if (!a) throw new AmuxError(`unknown agent '${name}'`);
    if (!(await sessionExists(a.session))) continue;
    await sendKeys(a.session, text);
    sent.push(name);
  }
  return sent;
}

export interface PrOpts {
  title?: string;
  body?: string;
  draft?: boolean;
}

/** Push the agent's branch and open a GitHub PR; returns the PR URL. */
export async function openPr(name: string, opts: PrOpts = {}): Promise<string> {
  const a = await store.get(name);
  if (!a) throw new AmuxError(`unknown agent '${name}'`);
  if (!(await ghAvailable())) throw new AmuxError("gh CLI not found (needed to open PRs)");
  await pushBranch(a.worktree, a.branch);
  const title = opts.title ?? a.branch;
  const body = opts.body ?? `Opened by hivemux for agent '${a.name}'.`;
  return createPR(a.worktree, title, body, Boolean(opts.draft));
}

export interface MergeOpts {
  into?: string;
  noFf?: boolean;
}

/** Merge an agent's branch into the base branch (default: repo's integration branch). */
export async function merge(name: string, opts: MergeOpts = {}): Promise<MergeResult> {
  const a = await store.get(name);
  if (!a) throw new AmuxError(`unknown agent '${name}'`);
  const into = opts.into ?? (await defaultBranch(a.repo));
  return mergeInto(a.repo, a.branch, into, opts.noFf ?? true);
}

export interface RepoCheck {
  valid: boolean;
  root?: string;
  name?: string;
  branch?: string;
  error?: string;
}

/** Validate a path as a git repo — used by the GUI to preview before creating. */
export async function checkRepo(dir: string): Promise<RepoCheck> {
  try {
    const root = await repoRoot(dir || ".");
    return { valid: true, root, name: repoName(root), branch: await currentBranch(root) };
  } catch {
    return { valid: false, error: "not inside a git repository" };
  }
}

export const GRID_SESSION = "hivemux-grid";

/** Build a tiled, read-only tmux view of all live agents; returns the live count. */
export async function grid(): Promise<number> {
  const agents = await store.getAll();
  const live: string[] = [];
  for (const a of agents) {
    if (await sessionExists(a.session)) live.push(a.session);
  }
  await buildGrid(GRID_SESSION, live);
  return live.length;
}

/** Record usage pushed by an agent hook (`hivemux report-usage`). */
export async function reportUsage(
  name: string,
  raw: RawUsage,
  model?: string,
  ctxTokens?: number,
): Promise<void> {
  if (!(await store.get(name))) throw new AmuxError(`unknown agent '${name}'`);
  await store.update(name, { usage: raw, usageModel: model, usageCtx: ctxTokens });
}

/** All agents enriched with computed usage (tokens/cost/context) + cap flags. */
export async function usageAll(): Promise<UsageView[]> {
  const views = await list();
  return Promise.all(
    views.map(async (v) => {
      const usageView = await agentUsage(v);
      const overCost =
        v.costCap != null && usageView.costUSD != null && usageView.costUSD >= v.costCap;
      const overCtx = v.ctxCap != null && usageView.ctxPct != null && usageView.ctxPct >= v.ctxCap;
      return { ...v, usageView, overCost, overCtx };
    }),
  );
}

/**
 * Install a Claude Code Stop hook in the worktree so each agent turn signals
 * completion to hivemux (`hivemux notify -s done`). This is what closes the loop.
 */
export async function installLoopHook(worktree: string): Promise<void> {
  const dir = path.join(worktree, ".claude");
  await mkdir(dir, { recursive: true });
  const settings = {
    hooks: { Stop: [{ hooks: [{ type: "command", command: "hivemux notify -s done" }] }] },
  };
  await writeFile(path.join(dir, "settings.json"), JSON.stringify(settings, null, 2));
}

export interface LoopOpts {
  commit?: boolean;
  pr?: boolean;
  installHook?: boolean;
}

/** Run a verify→fix loop on one agent; commit/PR on pass if requested. */
export async function loop(
  name: string,
  spec: LoopSpec,
  opts: LoopOpts = {},
  onLog: (m: string) => void = () => {},
): Promise<LoopResult> {
  const a = await store.get(name);
  if (!a) throw new AmuxError(`unknown agent '${name}'`);
  if (opts.installHook) await installLoopHook(a.worktree);
  const result = await runLoop(name, spec, onLog);
  if (result.passed) {
    if (opts.commit) await commitAll(a.worktree, `hivemux: ${spec.goal}`);
    if (opts.pr) await openPr(name, { title: spec.goal }).catch(() => {});
  }
  return result;
}

/** Spawn N agents (<base>-1..N) on the same repo and loop the same goal on each. */
export async function fleetLoop(
  base: string,
  count: number,
  agentKey: string,
  repo: string,
  spec: LoopSpec,
  opts: LoopOpts = {},
  onLog: (m: string) => void = () => {},
): Promise<Array<{ name: string; result: LoopResult }>> {
  const names = Array.from({ length: count }, (_, i) => `${base}-${i + 1}`);
  for (const name of names) {
    await create({ name, agent: agentKey, repo, costCap: undefined, ctxCap: undefined });
  }
  return Promise.all(
    names.map(async (name) => ({
      name,
      result: await loop(name, spec, opts, (m) => onLog(`[${name}] ${m}`)),
    })),
  );
}
