// Web dashboard server. Standalone — runs its own Watcher over the core, so it
// works without the daemon. Pushes a full snapshot to browsers over SSE on every
// change/tick. This is the remote-reachable control plane cmux can't offer:
// run it on the box where the agents live, open it from anywhere.
import { randomUUID } from "node:crypto";
import http from "node:http";
import { emit as emitIntegration } from "../core/integrations";
import * as mgr from "../core/manager";
import { ensureTerminal, stopAllTerminals, stopTerminal } from "../core/terminals";
import type { NewAgentOpts, Status } from "../core/types";
import { Watcher } from "../core/watcher";
import { TOOLS as MCP_TOOLS, VERSION as MCP_VERSION } from "../ipc/mcp";
import { FAVICON_SVG, ICONS, MANIFEST } from "./icons";
import { PAGE } from "./page";

function json(res: http.ServerResponse, body: unknown, code = 200): void {
  const s = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json" });
  res.end(s);
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

/** No token configured = open (loopback only). Otherwise require it via header or query. */
function authed(req: http.IncomingMessage, url: URL, token: string | undefined): boolean {
  if (!token) return true;
  return req.headers["x-hivemux-token"] === token || url.searchParams.get("token") === token;
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      try {
        resolve(b ? JSON.parse(b) : {});
      } catch {
        resolve({});
      }
    });
  });
}

export async function startWeb(
  port: number,
  host: string,
  token?: string,
): Promise<{ server: http.Server; token: string | undefined }> {
  // Never serve an exposed (non-loopback) dashboard without auth: mint a token.
  let authToken = token ?? process.env.HIVEMUX_WEB_TOKEN;
  if (!authToken && !LOOPBACK.has(host)) authToken = randomUUID();

  const clients = new Set<http.ServerResponse>();
  const watcher = new Watcher().start();

  const pushSnapshot = async () => {
    if (clients.size === 0) return;
    const agents = await mgr.list().catch(() => []);
    const data = `event: snapshot\ndata: ${JSON.stringify(agents)}\n\n`;
    for (const c of clients) c.write(data);
  };
  watcher.on("change", pushSnapshot);
  watcher.on("remove", pushSnapshot);

  // Cost/context cap poller: fire a one-shot alert (SSE + integrations) the first
  // time an agent crosses a cap.
  const alerted = new Set<string>();
  const capPoll = setInterval(async () => {
    const rows = await mgr.usageAll().catch(() => []);
    for (const r of rows) {
      const key = r.overCost ? `${r.name}:cost` : r.overCtx ? `${r.name}:ctx` : "";
      if (!key || alerted.has(key)) continue;
      alerted.add(key);
      const text = r.overCost
        ? `hivemux: '${r.name}' hit its cost cap ($${r.usageView.costUSD?.toFixed(2)})`
        : `hivemux: '${r.name}' hit its context cap (${r.usageView.ctxPct}%)`;
      const frame = `event: alert\ndata: ${JSON.stringify({ name: r.name, text })}\n\n`;
      for (const c of clients) c.write(frame);
      void emitIntegration(text, r);
    }
  }, 8000);
  capPoll.unref?.();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    try {
      // Brand icons + manifest are public (no token) so the browser tab/PWA works
      // before the page's auth header is in play.
      if (req.method === "GET" && path === "/favicon.svg") {
        res.writeHead(200, { "content-type": "image/svg+xml" });
        return res.end(FAVICON_SVG);
      }
      if (req.method === "GET" && path === "/manifest.webmanifest") {
        res.writeHead(200, { "content-type": "application/manifest+json" });
        return res.end(MANIFEST);
      }
      if (req.method === "GET" && ICONS[path.slice(1)]) {
        const ic = ICONS[path.slice(1)];
        if (ic) {
          res.writeHead(200, { "content-type": ic.type, "cache-control": "max-age=86400" });
          return res.end(Buffer.from(ic.b64, "base64"));
        }
      }
      if (!authed(req, url, authToken)) {
        res.writeHead(401, { "content-type": "text/plain" });
        return res.end("unauthorized: append ?token=… or send an x-hivemux-token header");
      }
      if (req.method === "GET" && path === "/") {
        // Inject the token so the page's fetch/SSE calls carry it.
        const page = PAGE.replace('"__HIVEMUX_TOKEN__"', JSON.stringify(authToken ?? ""));
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(page);
      }
      if (req.method === "GET" && path === "/api/agents") return json(res, await mgr.list());
      if (req.method === "GET" && path === "/api/conflicts")
        return json(res, await mgr.conflicts());
      if (req.method === "GET" && path === "/api/agent-keys")
        return json(res, await mgr.agentKeys());
      if (req.method === "GET" && path === "/api/repo-check")
        return json(res, await mgr.checkRepo(url.searchParams.get("path") ?? "."));
      if (req.method === "GET" && path === "/api/usage") return json(res, await mgr.usageAll());

      // Embedded terminal: ensure a ttyd is serving this agent, return its port.
      if (req.method === "GET" && path.startsWith("/api/term/")) {
        const name = decodeURIComponent(path.slice("/api/term/".length));
        return json(res, { port: await ensureTerminal(name) });
      }

      if (req.method === "GET" && path === "/api/events") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        res.write(": connected\n\n");
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }

      if (req.method === "POST" && path === "/api/new") {
        const b = await readBody(req);
        const a = await mgr.create(b as unknown as NewAgentOpts);
        await pushSnapshot();
        return json(res, a);
      }
      if (req.method === "POST" && path === "/api/kill") {
        const b = await readBody(req);
        stopTerminal(b.name as string);
        await mgr.kill(b.name as string, Boolean(b.rmWorktree));
        await pushSnapshot();
        return json(res, { ok: true });
      }
      if (req.method === "POST" && path === "/api/notify") {
        const b = await readBody(req);
        await mgr.notify(b.name as string, b.status as Status, (b.note as string) ?? "");
        await pushSnapshot();
        return json(res, { ok: true });
      }
      if (req.method === "POST" && path === "/api/loop/start") {
        const b = await readBody(req);
        const spec = {
          goal: b.goal as string,
          check: b.check as string | undefined,
          rubric: b.rubric as string | undefined,
          maxIters: typeof b.max === "number" ? b.max : 10,
          runner: (b.runner as string | undefined) || undefined,
        };
        const opts = { commit: Boolean(b.commit), pr: Boolean(b.pr) };
        if (typeof b.fleet === "number" && b.fleet > 0) {
          const base = (b.name as string) || `fleet-${Date.now().toString(36)}`;
          void mgr
            .fleetLoop(
              base,
              b.fleet,
              (b.agent as string) || "claude",
              (b.repo as string) || ".",
              spec,
              opts,
            )
            .catch(() => {});
          return json(res, {
            started: Array.from({ length: b.fleet as number }, (_, i) => `${base}-${i + 1}`),
          });
        }
        mgr.startLoopBg(b.name as string, spec, opts);
        return json(res, { started: b.name });
      }
      if (req.method === "POST" && path === "/api/loop/stop") {
        const b = await readBody(req);
        return json(res, { stopped: mgr.stopLoop(b.name as string) });
      }
      if (req.method === "GET" && path === "/api/loop/running")
        return json(res, mgr.runningLoops());
      if (req.method === "GET" && path === "/api/loop/log") {
        const name = url.searchParams.get("name") ?? "";
        return json(res, await mgr.loopHistory(name));
      }
      if (req.method === "POST" && path === "/api/prune") {
        const b = await readBody(req);
        const removed = await mgr.prune(Boolean(b.rmWorktree));
        await pushSnapshot();
        return json(res, { pruned: removed });
      }
      if (req.method === "GET" && path === "/api/mcp")
        return json(res, { version: MCP_VERSION, tools: MCP_TOOLS });
      if (req.method === "POST" && path === "/api/broadcast") {
        const b = await readBody(req);
        const names = Array.isArray(b.names) ? (b.names as string[]) : [];
        return json(res, { sent: await mgr.broadcast(names, (b.text as string) ?? "") });
      }
      if (req.method === "POST" && path === "/api/merge") {
        const b = await readBody(req);
        return json(res, await mgr.merge(b.name as string, { into: b.into as string | undefined }));
      }
      if (req.method === "POST" && path === "/api/pr") {
        const b = await readBody(req);
        return json(res, { url: await mgr.openPr(b.name as string, { title: b.title as string }) });
      }

      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    } catch (e) {
      json(res, { error: (e as Error).message }, 400);
    }
  });

  server.on("close", () => {
    watcher.stop();
    clearInterval(capPoll);
    stopAllTerminals();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(
          new Error(
            `port ${port} is already in use — pick another with --port, or free it (e.g. fuser -k ${port}/tcp)`,
          ),
        );
      } else {
        reject(err);
      }
    });
    server.listen(port, host, resolve);
  });
  return { server, token: authToken };
}
