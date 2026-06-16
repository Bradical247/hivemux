// End-to-end smoke of the hivemux web GUI against a real running server (see
// global-setup). Covers the surfaces that used to be verified only by hand:
// load, sidebar workspaces, toolbar, tile grid, loop + MCP modals, approval holds.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

const { port } = JSON.parse(readFileSync(path.resolve("e2e/.state.json"), "utf8"));
const BASE = `http://127.0.0.1:${port}`;

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/`);
  await expect(page.locator(".brand")).toContainText("hivemux");
});

test("sidebar lists the running agents", async ({ page }) => {
  await expect(page.locator(".ws", { hasText: "e2e-a" })).toBeVisible();
  await expect(page.locator(".ws", { hasText: "e2e-b" })).toBeVisible();
});

test("toolbar exposes the full feature set", async ({ page }) => {
  for (const id of ["loopbtn", "fleetbtn", "mcpbtn", "prunebtn", "tilebtn", "mergebtn", "prbtn", "killbtn"]) {
    await expect(page.locator(`#${id}`)).toBeVisible();
  }
});

test("tile view renders one cell per live agent", async ({ page }) => {
  await page.locator("#tilebtn").click();
  const cells = page.locator("#grid .cell");
  await expect(cells).toHaveCount(2);
  await expect(page.locator("#grid .hd", { hasText: "e2e-a" })).toBeVisible();
  await expect(page.locator("#grid .hd", { hasText: "e2e-b" })).toBeVisible();
});

test("loop modal opens and toggles verifier fields", async ({ page }) => {
  await page.locator(".ws", { hasText: "e2e-a" }).click(); // select first
  await page.locator("#loopbtn").click();
  await expect(page.locator("#loopmodal")).toBeVisible();
  await expect(page.locator("#l_goal")).toBeVisible();
  await expect(page.locator("#l_check")).toBeVisible();
  // switching the verifier to the LLM judge reveals the rubric field
  await page.locator("#l_vtype").selectOption("rubric");
  await expect(page.locator("#l_rubricfield")).toBeVisible();
  await page.locator("#l_cancel").click();
  await expect(page.locator("#loopmodal")).toBeHidden();
});

test("MCP panel shows the live tool list", async ({ page }) => {
  await page.locator("#mcpbtn").click();
  await expect(page.locator("#mcpmodal")).toBeVisible();
  await expect(page.locator("#mcp_count")).toContainText(/\d+/);
  await page.locator("#mcp_close").click();
});

test("approval hold shows approve/deny, and deny clears it", async ({ page }) => {
  const held = page.locator(".ws", { hasText: "e2e-a" }).locator(".pend");
  await expect(held).toBeVisible();
  await expect(held).toContainText("held");
  // deny removes the hold; the .pend element should disappear after the next snapshot
  await held.getByText("deny").click();
  await expect(held).toBeHidden({ timeout: 5000 });
});
