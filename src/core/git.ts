// Git worktree management: each agent gets its own working dir + branch,
// all sharing one .git so agents cannot collide on each other's files.
import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const pexec = promisify(execFile);

export async function repoRoot(dir: string): Promise<string> {
  const { stdout } = await pexec("git", ["-C", dir, "rev-parse", "--show-toplevel"]);
  return stdout.trim();
}

/** True if `dir` is inside a git work tree. */
export async function isRepo(dir: string): Promise<boolean> {
  try {
    await pexec("git", ["-C", dir, "rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Turn `dir` into a fresh git repo so hivemux works anywhere, not just inside an
 * existing project. Creates the dir if needed, `git init`s it, and makes an EMPTY
 * initial commit (a HEAD is all `worktree add` needs). It deliberately does NOT
 * `git add` existing files, so running hivemux from a populated dir (even $HOME)
 * never sweeps unrelated files into a commit. Falls back to a bootstrap identity
 * only if the user has no global git identity configured.
 */
export async function initRepo(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  await pexec("git", ["-C", dir, "init", "-b", "main"]);
  const msg = "hivemux: initial commit";
  try {
    await pexec("git", ["-C", dir, "commit", "--allow-empty", "-m", msg]);
  } catch {
    await pexec("git", [
      "-C",
      dir,
      "-c",
      "user.name=hivemux",
      "-c",
      "user.email=hivemux@localhost",
      "commit",
      "--allow-empty",
      "-m",
      msg,
    ]);
  }
  return repoRoot(dir);
}

export function repoName(root: string): string {
  return path.basename(root);
}

export function worktreesDir(root: string): string {
  return path.join(os.homedir(), ".hivemux", "worktrees", repoName(root));
}

/** Create ~/.hivemux/worktrees/<repo>/<name> on a fresh branch. Returns the path. */
export async function addWorktree(
  root: string,
  name: string,
  branch: string,
  base?: string,
): Promise<string> {
  const dir = path.join(worktreesDir(root), name);
  await mkdir(path.dirname(dir), { recursive: true });
  const args = ["-C", root, "worktree", "add", "-b", branch, dir];
  if (base) args.push(base);
  await pexec("git", args);
  return dir;
}

export async function removeWorktree(root: string, dir: string): Promise<void> {
  await pexec("git", ["-C", root, "worktree", "remove", "--force", dir]);
}

/** Files changed on an agent's branch vs its base — used for conflict detection. */
export async function changedFiles(worktree: string): Promise<string[]> {
  try {
    const { stdout } = await pexec("git", ["-C", worktree, "status", "--porcelain", "-uall"]);
    return stdout
      .split("\n")
      .filter(Boolean)
      .map((l) => l.slice(3));
  } catch {
    return [];
  }
}

export async function currentBranch(dir: string): Promise<string> {
  const { stdout } = await pexec("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"]);
  return stdout.trim();
}

/** The repo's integration branch: origin/HEAD if set, else main/master, else current. */
export async function defaultBranch(root: string): Promise<string> {
  try {
    const { stdout } = await pexec("git", [
      "-C",
      root,
      "symbolic-ref",
      "--short",
      "refs/remotes/origin/HEAD",
    ]);
    return stdout.trim().replace(/^origin\//, "");
  } catch {
    for (const b of ["main", "master"]) {
      try {
        await pexec("git", ["-C", root, "rev-parse", "--verify", b]);
        return b;
      } catch {
        /* not present */
      }
    }
    return currentBranch(root);
  }
}

export async function pushBranch(
  worktree: string,
  branch: string,
  remote = "origin",
): Promise<void> {
  await pexec("git", ["-C", worktree, "push", "-u", remote, branch]);
}

export interface MergeResult {
  merged: boolean;
  into: string;
  conflicts: string[];
}

/**
 * Check out `into` in the main repo and merge `branch`. On conflict, collect the
 * conflicted paths and `merge --abort` so the working tree is left clean rather
 * than half-merged — hivemux reports, the human resolves.
 */
export async function mergeInto(
  root: string,
  branch: string,
  into: string,
  noFf = true,
): Promise<MergeResult> {
  await pexec("git", ["-C", root, "checkout", into]);
  try {
    await pexec("git", ["-C", root, "merge", noFf ? "--no-ff" : "--ff", branch]);
    return { merged: true, into, conflicts: [] };
  } catch {
    let conflicts: string[] = [];
    try {
      const { stdout } = await pexec("git", ["-C", root, "diff", "--name-only", "--diff-filter=U"]);
      conflicts = stdout.split("\n").filter(Boolean);
    } catch {
      /* ignore */
    }
    await pexec("git", ["-C", root, "merge", "--abort"]).catch(() => {});
    return { merged: false, into, conflicts };
  }
}

export async function ghAvailable(): Promise<boolean> {
  try {
    await pexec("gh", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

/** Stage everything in the worktree and commit; false if nothing to commit. */
export async function commitAll(worktree: string, message: string): Promise<boolean> {
  try {
    await pexec("git", ["-C", worktree, "add", "-A"]);
    await pexec("git", ["-C", worktree, "commit", "-m", message]);
    return true;
  } catch {
    return false;
  }
}

/** Open a GitHub PR from `worktree`'s branch via the `gh` CLI; returns the PR URL. */
export async function createPR(
  worktree: string,
  title: string,
  body: string,
  draft: boolean,
): Promise<string> {
  const args = ["pr", "create", "--title", title, "--body", body];
  if (draft) args.push("--draft");
  const { stdout } = await pexec("gh", args, { cwd: worktree });
  return stdout.trim();
}
