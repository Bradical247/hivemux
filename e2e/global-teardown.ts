// Kills the GUI server + throwaway agents and removes the temp $HOME/repo.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

const BIN = path.resolve("dist/hivemux");
const STATE = path.resolve("e2e/.state.json");

export default async function globalTeardown() {
  if (!existsSync(STATE)) return;
  const { port: _port, home, repo, pid, agents } = JSON.parse(readFileSync(STATE, "utf8"));
  const env = { ...process.env, HOME: home };

  for (const name of agents ?? []) {
    try {
      execFileSync(BIN, ["kill", name, "--rm-worktree"], { env, stdio: "ignore" });
    } catch { /* already gone */ }
  }
  if (pid) {
    try { process.kill(pid); } catch { /* already gone */ }
  }
  for (const dir of [home, repo]) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  try { rmSync(STATE); } catch { /* ignore */ }
}
