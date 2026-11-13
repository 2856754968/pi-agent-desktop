import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

// Exercise the real grouped sidebar with a version-stable list and live SSE.
// A run transition must refresh timestamps even when the session already exists.
const out = "test-results/sidebar-recency";
await mkdir(out, { recursive: true });
await build({ entryPoints: ["e2e/project-rename.fixture.tsx"], bundle: true, platform: "browser", format: "iife",
  outfile: out + "/fixture.js", define: { "process.env.NODE_ENV": '"production"' }, jsx: "automatic", logLevel: "warning" });
const js = await readFile(out + "/fixture.js");
const css = (await Promise.all(["app/globals.css", "app/settings.css", "app/native-theme.css"].map(p => readFile(p, "utf8"))))
  .map(text => text.replace(/^@import[^;]*;/gm, "")).join("\n");
const streams = new Set();
let running = [];
const broadcast = () => {
  const frame = `data: ${JSON.stringify({ type: "running", runningSessionIds: running, sessionListVersion: 1 })}\n\n`;
  for (const response of streams) response.write(frame);
};
const server = createServer((req, res) => {
  if (req.url === "/api/agent/running/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    streams.add(res);
    broadcast();
    req.on("close", () => streams.delete(res));
    return;
  }
  if (req.url === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); res.end(js); return; }
  if (req.url === "/style.css") { res.setHeader("Content-Type", "text/css"); res.end(css); return; }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body style="margin:0"><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, channel: process.env.E2E_BROWSER_CHANNEL || "chrome" });
const session = (id, name, modified, cwd = "D:/work/app", parentSessionId) => ({
  id, name, modified, created: "2026-11-01T10:00:00Z", path: cwd + "/" + id + ".jsonl", cwd, projectRoot: cwd,
  workspaceKind: "project", firstMessage: name, messageCount: 2, parentSessionId,
});
try {
  for (const theme of ["light", "dark"]) for (const width of [1280, 390]) {
    running = [];
    const sessions = [session("old", "Old conversation", "2026-11-01T10:00:00Z"),
      session("recent", "Recent conversation", "2026-11-10T10:00:00Z"),
      session("other", "Other project", "2026-11-09T10:00:00Z", "D:/other/app"),
      session("fork", "Old fork", "2026-11-02T10:00:00Z", "D:/work/app", "old")];
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(theme => {
      localStorage.setItem("pi-locale", "zh-CN");
      document.addEventListener("DOMContentLoaded", () => document.documentElement.classList.toggle("dark", theme === "dark"));
    }, theme);
    await page.route("**/api/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/agent/running/events") return route.continue();
      let data = {};
      if (url.pathname === "/api/sessions") data = { sessions, sessionListVersion: 1, runningSessionIds: running };
      if (url.pathname === "/api/worktrees") data = { projectRoot: "D:/work/app", isGit: false, worktrees: [], branches: [], remoteBranches: [] };
      if (url.pathname === "/api/home") data = { home: "D:/" };
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
    });
    await page.goto("http://127.0.0.1:" + server.address().port);
    const group = page.locator(".sidebar-project-tree-group").filter({ has: page.locator('.session-item', { hasText: "Recent conversation" }) });
    await group.waitFor();
    const firstTitle = () => group.locator(".session-item").first().innerText();
    assert.match(await firstTitle(), /Recent conversation/);
    sessions[0].modified = "2026-11-11T10:00:00Z";
    running = ["old"];
    const started = page.waitForResponse(r => new URL(r.url()).pathname === "/api/sessions");
    broadcast();
    await started;
    await page.waitForFunction(() => document.querySelector(".sidebar-project-tree-group .session-item")?.textContent.includes("Old conversation"));
    assert.match(await firstTitle(), /Old conversation/);
    assert.equal(await page.locator(".sidebar-project-tree-group").count(), 2, "project groups remain visible");
    assert.equal(await page.locator(".sidebar-project-timeline").count(), 0, "recency does not flatten the project tree");
    sessions[0].modified = "2026-11-11T10:05:00Z";
    running = [];
    const finished = page.waitForResponse(r => new URL(r.url()).pathname === "/api/sessions");
    broadcast();
    await finished;
    // A continued fork raises its containing tree without changing its hierarchy.
    sessions[1].modified = "2026-11-11T11:00:00Z";
    sessions[3].modified = "2026-11-11T12:00:00Z";
    running = ["fork"];
    const forkStarted = page.waitForResponse(r => new URL(r.url()).pathname === "/api/sessions");
    broadcast();
    await forkStarted;
    assert.match(await firstTitle(), /Old conversation/);
    await page.screenshot({ path: `${out}/${theme}-${width}.png` });
    await page.reload();
    await group.waitFor();
    assert.match(await firstTitle(), /Old conversation/, "persisted timestamps retain order after reload");
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`PASS grouped recency, resumed session, completion, fork, reload: ${theme} ${width}`);
  }
} finally {
  await browser.close();
  for (const response of streams) response.end();
  await new Promise(resolve => server.close(resolve));
}
