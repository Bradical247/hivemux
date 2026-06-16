// Async wrapper over the tmux CLI. tmux is the session/PTY/persistence engine;
// hivemux drives it, never reimplements it. Async so a long-lived daemon serving
// many clients never blocks the event loop on a shell-out.
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);

export async function sessionExists(name: string): Promise<boolean> {
  try {
    await pexec("tmux", ["has-session", "-t", name]);
    return true;
  } catch {
    return false;
  }
}

export async function newSession(
  name: string,
  cwd: string,
  env: Record<string, string>,
  cmd?: string,
): Promise<void> {
  const args = ["new-session", "-d", "-s", name, "-c", cwd];
  // tmux >= 3.2: -e KEY=VAL puts the var in the spawned shell's environment.
  for (const [k, v] of Object.entries(env)) args.push("-e", `${k}=${v}`);
  await pexec("tmux", args);
  if (cmd?.trim()) await pexec("tmux", ["send-keys", "-t", name, cmd, "Enter"]);
}

export async function killSession(name: string): Promise<void> {
  if (await sessionExists(name)) await pexec("tmux", ["kill-session", "-t", name]);
}

/** Type text into a session and press Enter — used by `broadcast`. */
export async function sendKeys(session: string, text: string): Promise<void> {
  await pexec("tmux", ["send-keys", "-t", session, text, "Enter"]);
}

/**
 * Build a detached "grid" session: one tiled, read-only pane per given session.
 * Each pane runs a loop that mirrors the agent's output via `capture-pane`,
 * refreshing once a second. (Nested `tmux attach` dies when built detached; a
 * capture loop stays alive and renders correctly once a client attaches.)
 * Rebuilt from scratch each call; the caller attaches to it separately.
 */
export async function buildGrid(grid: string, sessions: string[]): Promise<void> {
  await killSession(grid);
  const first = sessions[0];
  if (!first) return;
  const mirror = (s: string) =>
    `while tmux has-session -t ${s} 2>/dev/null; do clear; printf '── %s ──\\n' ${s}; tmux capture-pane -ept ${s}; sleep 1; done`;
  await pexec("tmux", ["new-session", "-d", "-s", grid, mirror(first)]);
  for (const s of sessions.slice(1)) {
    await pexec("tmux", ["split-window", "-t", grid, mirror(s)]);
    await pexec("tmux", ["select-layout", "-t", grid, "tiled"]);
  }
  await pexec("tmux", ["select-layout", "-t", grid, "tiled"]);
}

/** Attach (or switch, if already inside tmux). Synchronous: it takes over the TTY. */
export function attach(name: string): void {
  const verb = process.env.TMUX ? "switch-client" : "attach";
  spawnSync("tmux", [verb, "-t", name], { stdio: "inherit" });
}
