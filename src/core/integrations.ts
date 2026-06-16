// Outbound integrations. Fired when an agent crosses a cost/context cap.
// Configured in ~/.hivemux/config.json:
//   { "integrations": { "slackWebhook": "https://hooks.slack.com/…",
//                        "webhook": "https://example.com/hivemux" } }
// Slack gets a {text} payload; the generic webhook gets {text, data}.
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

interface IntegrationConfig {
  slackWebhook?: string;
  webhook?: string;
}

async function config(): Promise<IntegrationConfig> {
  try {
    const cfg = JSON.parse(
      await readFile(path.join(os.homedir(), ".hivemux", "config.json"), "utf8"),
    );
    return (cfg.integrations ?? {}) as IntegrationConfig;
  } catch {
    return {};
  }
}

export async function emit(text: string, data: unknown): Promise<void> {
  const c = await config();
  const posts: Promise<unknown>[] = [];
  const post = (url: string, body: unknown) =>
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => undefined);
  if (c.slackWebhook) posts.push(post(c.slackWebhook, { text }));
  if (c.webhook) posts.push(post(c.webhook, { text, data }));
  await Promise.all(posts);
}

export async function configured(): Promise<boolean> {
  const c = await config();
  return Boolean(c.slackWebhook || c.webhook);
}
