// OS-level sandbox for agent execution. A looped agent runs headless with
// acceptEdits — nothing stops it writing outside its worktree. We confine it:
// the whole filesystem is read-only except the worktree, /tmp, and the agent's
// own config/state dirs. Network stays on by default (the model API needs it).
//
//   Linux  → bwrap (bubblewrap)        Linux requires it for confinement.
//   macOS  → sandbox-exec (seatbelt)   built in.
//   else   → passthrough (a warning is the caller's job).
//
// ponytail: filesystem confinement only — not a full security boundary. It stops
// an agent trashing $HOME, not a determined escape.
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type SandboxKind = "bwrap" | "seatbelt" | "none";
export type SandboxMode = "auto" | "on" | "off";

function has(bin: string): boolean {
  const dirs = (process.env.PATH ?? "").split(":");
  return dirs.some((d) => d && existsSync(path.join(d, bin)));
}

/** Which sandbox this host can use. */
export function sandboxKind(): SandboxKind {
  if (process.platform === "linux" && has("bwrap")) return "bwrap";
  if (process.platform === "darwin" && has("sandbox-exec")) return "seatbelt";
  return "none";
}

// Home dirs an agent legitimately writes to (auth, session transcripts, caches).
function writableHomeDirs(): string[] {
  const h = os.homedir();
  return [".hivemux", ".claude", ".codex", ".config", ".cache", ".gemini", ".aider"].map((d) =>
    path.join(h, d),
  );
}

export interface WrapOpts {
  worktree: string;
  network?: boolean; // default true
  mode?: SandboxMode; // default "auto"
  // Extra writable paths. A git worktree's .git lives in the MAIN repo's
  // .git/worktrees/<name>, outside the worktree — bind it or git breaks.
  extraBinds?: string[];
}

/** Wrap [bin, ...args] so it runs confined to `worktree`. Returns the original
 *  command unchanged when sandboxing is off or unavailable. */
export function wrap(bin: string, args: string[], opts: WrapOpts): { bin: string; args: string[] } {
  const mode = opts.mode ?? "auto";
  if (mode === "off") return { bin, args };
  const kind = sandboxKind();
  if (kind === "none") return { bin, args };
  const net = opts.network !== false;

  if (kind === "bwrap") {
    const a = [
      "--ro-bind",
      "/",
      "/",
      "--dev",
      "/dev",
      "--proc",
      "/proc",
      "--tmpfs",
      "/tmp",
      "--bind",
      opts.worktree,
      opts.worktree,
      "--die-with-parent",
    ];
    for (const d of [...writableHomeDirs(), ...(opts.extraBinds ?? [])]) a.push("--bind-try", d, d);
    a.push(net ? "--share-net" : "--unshare-net");
    a.push("--", bin, ...args);
    return { bin: "bwrap", args: a };
  }

  // seatbelt: deny all writes, then allow worktree + scratch + agent config.
  const allow = [
    opts.worktree,
    "/tmp",
    os.tmpdir(),
    ...writableHomeDirs(),
    ...(opts.extraBinds ?? []),
  ]
    .map((p) => `(subpath "${p}")`)
    .join(" ");
  const profile = [
    "(version 1)",
    "(allow default)",
    '(deny file-write* (subpath "/"))',
    `(allow file-write* ${allow})`,
    net ? "" : "(deny network*)",
  ].join(" ");
  return { bin: "sandbox-exec", args: ["-p", profile, bin, ...args] };
}
