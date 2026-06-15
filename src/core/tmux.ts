// Async wrapper over the tmux CLI. tmux is the session/PTY/persistence engine;
// amux drives it, never reimplements it. Async so a long-lived daemon serving
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

export async function listSessionNames(): Promise<string[]> {
  try {
    const { stdout } = await pexec("tmux", ["list-sessions", "-F", "#{session_name}"]);
    return stdout.split("\n").filter(Boolean);
  } catch {
    return []; // no server running == no sessions
  }
}

/** Attach (or switch, if already inside tmux). Synchronous: it takes over the TTY. */
export function attach(name: string): void {
  const verb = process.env.TMUX ? "switch-client" : "attach";
  spawnSync("tmux", [verb, "-t", name], { stdio: "inherit" });
}
