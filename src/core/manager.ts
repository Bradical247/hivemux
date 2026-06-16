// The orchestration core. Every frontend — CLI, daemon/IPC, future TUI and web —
// calls these functions. No frontend talks to tmux/git/store directly, so there
// is exactly one source of truth and one place to evolve behavior.
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
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
  initRepo,
  type MergeResult,
  mergeInto,
  pushBranch,
  removeWorktree,
  repoName,
  repoRoot,
} from "./git";
import {
  runningLoops as _runningLoops,
  stopLoop as _stopLoop,
  type LoopResult,
  type LoopSpec,
  loopHistoryFile,
  runLoop,
} from "./loop";
import { loadPolicy } from "./policy";
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

  // Resolve the repo root. If `repo` isn't a git repo yet, init a fresh one (an
  // empty commit, no file sweep) so hivemux works from any directory. Opt out with
  // init:false to get the old "must be in a repo" behaviour.
  let root: string;
  try {
    root = await repoRoot(opts.repo);
  } catch {
    if (opts.init === false) {
      throw new AmuxError("not inside a git repo (pass a repo, or allow git-init)");
    }
    root = await initRepo(opts.repo);
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
  init?: boolean; // not a repo yet, but creating an agent here will git-init one
}

/** Validate a path as a git repo — used by the GUI to preview before creating. */
export async function checkRepo(dir: string): Promise<RepoCheck> {
  try {
    const root = await repoRoot(dir || ".");
    return { valid: true, root, name: repoName(root), branch: await currentBranch(root) };
  } catch {
    // not a repo yet — creating an agent here will git-init a fresh one
    return { valid: false, init: true, name: path.basename(path.resolve(dir || ".")) };
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

export interface LoopOpts {
  commit?: boolean;
  pr?: boolean;
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
  const result = await runLoop(name, spec, onLog);
  if (result.passed && (opts.commit || opts.pr)) {
    // Governance: under requireApproval, hold the risky git action for a human.
    if (loadPolicy().requireApproval) {
      await savePending(name, { goal: spec.goal, commit: !!opts.commit, pr: !!opts.pr });
      onLog(`held for approval — run 'hivemux approve ${name}' (or 'deny')`);
      return { ...result, reason: "awaiting-approval" };
    }
    if (opts.commit) await commitAll(a.worktree, `hivemux: ${spec.goal}`);
    if (opts.pr) await openPr(name, { title: spec.goal }).catch(() => {});
  }
  return result;
}

interface Pending {
  goal: string;
  commit: boolean;
  pr: boolean;
}
function pendingFile(name: string): string {
  return path.join(os.homedir(), ".hivemux", "pending", `${encodeURIComponent(name)}.json`);
}
async function savePending(name: string, p: Pending): Promise<void> {
  const f = pendingFile(name);
  await mkdir(path.dirname(f), { recursive: true });
  await writeFile(f, JSON.stringify(p));
}

/** Agents with a commit/PR held for approval. */
export async function listPending(): Promise<string[]> {
  try {
    const dir = path.join(os.homedir(), ".hivemux", "pending");
    return (await readdir(dir))
      .filter((f) => f.endsWith(".json"))
      .map((f) => decodeURIComponent(f.slice(0, -5)));
  } catch {
    return [];
  }
}

/** Approve a held action: perform the commit/PR and clear the hold. */
export async function approve(name: string): Promise<{ committed: boolean; pr?: string }> {
  const a = await store.get(name);
  if (!a) throw new AmuxError(`unknown agent '${name}'`);
  let p: Pending;
  try {
    p = JSON.parse(await readFile(pendingFile(name), "utf8"));
  } catch {
    throw new AmuxError(`no pending action for '${name}'`);
  }
  let pr: string | undefined;
  if (p.commit) await commitAll(a.worktree, `hivemux: ${p.goal}`);
  if (p.pr) pr = await openPr(name, { title: p.goal }).catch(() => undefined);
  await rm(pendingFile(name), { force: true });
  return { committed: !!p.commit, pr };
}

/** Discard a held action without performing it. */
export async function denyApproval(name: string): Promise<void> {
  await rm(pendingFile(name), { force: true });
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

/** Start a loop in the background (fire-and-poll). Returns immediately. */
export function startLoopBg(name: string, spec: LoopSpec, opts: LoopOpts = {}): void {
  void loop(name, spec, opts).catch(() => {});
}

/** Cancel a running loop at its next iteration boundary. */
export function stopLoop(name: string): boolean {
  return _stopLoop(name);
}

/** Names of loops currently running in this process. */
export function runningLoops(): string[] {
  return _runningLoops();
}

/** Read a loop's per-iteration history (newest events last). */
export async function loopHistory(name: string): Promise<Array<Record<string, unknown>>> {
  try {
    const text = await readFile(loopHistoryFile(name), "utf8");
    return text
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  } catch {
    return [];
  }
}
