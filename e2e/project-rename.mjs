import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

const out = "test-results/project-rename";
await mkdir(out, { recursive: true });
await build({ entryPoints: ["e2e/project-rename.fixture.tsx"], bundle: true, platform: "browser", format: "iife",
  outfile: out + "/fixture.js", define: { "process.env.NODE_ENV": '"production"' }, jsx: "automatic", logLevel: "warning" });
const js = await readFile(out + "/fixture.js");
const css = (await Promise.all(["app/globals.css", "app/settings.css", "app/native-theme.css"].map((p) => readFile(p, "utf8"))))
  .map((text) => text.replace(/^@import[^;]*;/gm, "")).join("\n");
const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/fixture.js" ? "text/javascript" : req.url === "/style.css" ? "text/css" : "text/html; charset=utf-8");
  res.end(req.url === "/fixture.js" ? js : req.url === "/style.css" ? css : '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body style="margin:0"><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, channel: process.env.E2E_BROWSER_CHANNEL || "chrome" });
const base = "http://127.0.0.1:" + server.address().port;
try {
  for (const theme of ["light", "dark"]) for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript((theme) => {
      localStorage.setItem("pi-locale", "zh-CN");
      document.addEventListener("DOMContentLoaded", () => document.documentElement.classList.toggle("dark", theme === "dark"));
    }, theme);
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      let data = {};
      if (url.pathname === "/api/sessions") data = { sessions: ["D:/work/app", "D:/other/app"].map((cwd, i) => ({
        id: "session-" + i, path: cwd + "/session.jsonl", cwd, projectRoot: cwd, projectKey: cwd.toLowerCase(), workspaceKind: "project",
        timestamp: "2026-10-30T10:00:00Z", modified: "2026-10-30T10:00:00Z", firstMessage: "Example", messageCount: 2,
      })) };
      if (url.pathname === "/api/worktrees") data = { projectRoot: "D:/work/app", isGit: false, worktrees: [], branches: [], remoteBranches: [] };
      if (url.pathname === "/api/home") data = { home: "D:/" };
      if (url.pathname.includes("running")) data = { running: [] };
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
    });
    await page.goto(base);
    // Scope to the actual project header instead of session action buttons.
    const openRename = async () => {
      const row = page.locator('.sidebar-project-tree-row').filter({ hasText: /work\/app|业务 A/ });
      await row.hover();
      await row.locator('button[aria-haspopup="menu"]').click();
      await page.getByRole("menuitem", { name: "重命名项目", exact: true }).click();
    };
    await openRename();
    const input = page.getByRole("textbox", { name: "项目名称", exact: true });
    await input.waitFor();
    assert.equal(await input.evaluate((el) => el === document.activeElement), true);
    await input.fill("业务 A");
    await input.evaluate((el) => el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true })));
    assert.equal(await input.count(), 1, "IME Enter must not submit");
    await page.screenshot({ path: `${out}/${theme}-${width}.png` });
    const rect = await page.getByRole("dialog").boundingBox();
    assert.ok(rect.x >= 0 && rect.x + rect.width <= width + 1, "dialog fits viewport");
    await input.press("Enter");
    await page.locator('.sidebar-project-tree-name').getByText("业务 A", { exact: true }).waitFor();
    assert.equal(await page.locator('.chat-project-context').innerText(), "业务 A");
    await page.reload();
    await page.locator('.sidebar-project-tree-name').getByText("业务 A", { exact: true }).waitFor();
    await openRename();
    await input.fill("取消的名称");
    await input.press("Escape");
    assert.equal(await page.locator('.chat-project-context').innerText(), "业务 A");
    await openRename();
    await input.fill("");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.locator('.sidebar-project-tree-name').getByText("work/app", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem("pi-web:project-names")), null);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`PASS rename, IME, cancel, reset, persistence: ${theme} ${width}px`);
  }
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
