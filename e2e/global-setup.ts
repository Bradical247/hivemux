// Boots a real hivemux GUI for the E2E run, isolated under a temp $HOME so it
// never touches the developer's ~/.hivemux. Creates two throwaway `shell` agents
// (real tmux sessions, no agent CLI, no API cost) so the sidebar + tile grid have
// something to render, and seeds one approval hold so the approve/deny UI shows.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

const BIN = path.resolve("dist/hivemux");
const STATE = path.resolve("e2e/.state.json");

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => res(p));
    });
    s.on("error", rej);
  });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default async function globalSetup() {
  const home = mkdtempSync(path.join(tmpdir(), "hivemux-e2e-home-"));
  const repo = mkdtempSync(path.join(tmpdir(), "hivemux-e2e-repo-"));
  const env = { ...process.env, HOME: home };

  // a tiny git repo to branch agents from
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo, env });
  execFileSync("git", ["-c", "user.email=e2e@x", "-c", "user.name=e2e", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: repo, env });

  // two real shell agents (tmux sessions, no claude)
  for (const name of ["e2e-a", "e2e-b"]) {
    execFileSync(BIN, ["new", name, "--repo", repo, "--agent", "shell"], { env, stdio: "ignore" });
  }

  // seed one approval hold so the GUI shows approve/deny for e2e-a
  const pendingDir = path.join(home, ".hivemux", "pending");
  mkdirSync(pendingDir, { recursive: true });
  writeFileSync(path.join(pendingDir, "e2e-a.json"), JSON.stringify({ goal: "demo hold", commit: true, pr: false }));

  const port = await freePort();
  const srv: ChildProcess = spawn(BIN, ["gui", "--port", String(port)], {
    env,
    detached: true,
    stdio: "ignore",
  });
  srv.unref();

  // wait for the server to answer
  let up = false;
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/`);
      if (r.ok) { up = true; break; }
    } catch { /* not yet */ }
    await sleep(200);
  }
  if (!up) throw new Error(`hivemux gui did not come up on :${port}`);

  writeFileSync(STATE, JSON.stringify({ port, home, repo, pid: srv.pid, agents: ["e2e-a", "e2e-b"] }));
  process.env.HIVEMUX_E2E_PORT = String(port);
}
