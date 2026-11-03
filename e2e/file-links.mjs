import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";

const out = "test-results/file-links";
await mkdir(out, { recursive: true });
await build({ entryPoints: ["e2e/file-links.fixture.tsx"], outfile: `${out}/fixture.js`, bundle: true, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, logLevel: "warning" });
const script = await readFile(`${out}/fixture.js`);
const css = (await Promise.all(["app/globals.css", "app/settings.css", "app/native-theme.css"].map((p) => readFile(p, "utf8")))).join("\n").replace(/^@import[^;]*;/gm, "");
const server = createServer((req, res) => {
  if (req.url === "/fixture.js") { res.setHeader("Content-Type", "text/javascript; charset=utf-8"); return res.end(script); }
  if (req.url.startsWith("/api/files/")) {
    const url = new URL(req.url, "http://localhost");
    const second = url.searchParams.has("offset");
    const markdown = req.url.includes("readme.md");
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ content: Array.from({ length: 100 }, (_, i) => `line ${i + (second ? 101 : 1)}`).join("\n") + "\n", language: markdown ? "markdown" : "typescript", size: 2000, truncated: !second, nextOffset: second ? undefined : 1000 }));
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<!doctype html><html><head><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : undefined), headless: true });
try {
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width: 900, height: 650 } });
    const errors = []; page.on("pageerror", (e) => errors.push(e.stack || e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate((theme) => document.documentElement.dataset.theme = theme, theme);
    await page.waitForSelector(".markdown-body", { timeout: 5000 }).catch(async (error) => { console.log(errors, await page.locator("body").innerText()); throw error; });
    for (const [name, line] of [["Windows", 42], ["Later", 150], ["Windows", 42], ["Markdown", 42]]) {
      await page.getByRole("link", { name, exact: true }).click();
      const target = page.locator(`.file-source-line[data-line-number="${line}"]`);
      await target.waitFor();
      await page.waitForFunction((line) => {
        const el = document.querySelector(`.file-source-line[data-line-number="${line}"]`);
        const root = document.querySelector(".file-viewer-content");
        if (!el || !root) return false;
        const a = el.getBoundingClientRect(), b = root.getBoundingClientRect();
        return a.top >= b.top && a.bottom <= b.bottom;
      }, line);
    }
    await page.screenshot({ path: `${out}/${theme}.png` });
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log("PASS: Windows links, source line jumps, repeated clicks, paginated files and Markdown source in both themes");
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
