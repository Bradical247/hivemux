// The orchestration core. Every frontend — CLI, daemon/IPC, future TUI and web —
// calls these functions. No frontend talks to tmux/git/store directly, so there
// is exactly one source of truth and one place to evolve behavior.
import { agentKeys as _agentKeys, resolveAgent } from "./agents";
import {
  addWorktree,
  changedFiles,
  createPR,
  defaultBranch,
  ghAvailable,
  type MergeResult,
  mergeInto,
  pushBranch,
  removeWorktree,
  repoRoot,
} from "./git";
import * as store from "./store";
import { killSession, newSession, sendKeys, sessionExists } from "./tmux";
import type { Agent, AgentView, Conflict, NewAgentOpts } from "./types";

export class AmuxError extends Error {}

function sessionName(name: string): string {
  return `amux-${name}`;
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

  const branch = opts.branch ?? `amux/${opts.name}`;
  const def = await resolveAgent(opts.agent);
  const worktree = await addWorktree(root, opts.name, branch, opts.base);

  await newSession(session, worktree, { AMUX_NAME: opts.name }, def.cmd);
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
  };
  await store.put(agent);
  return agent;
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
  const body = opts.body ?? `Opened by amux for agent '${a.name}'.`;
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
