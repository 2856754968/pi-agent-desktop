import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";

const out = "test-results/clipboard";
await mkdir(out, { recursive: true });
await build({ entryPoints: ["e2e/clipboard.fixture.tsx"], outfile: `${out}/fixture.js`, bundle: true, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, logLevel: "warning" });
const script = await readFile(`${out}/fixture.js`);
const css = (await Promise.all(["app/globals.css", "app/settings.css", "app/native-theme.css"].map((p) => readFile(p, "utf8")))).join("\n").replace(/^@import[^;]*;/gm, "");
const server = createServer((req, res) => {
  if (req.url === "/fixture.js") { res.setHeader("Content-Type", "text/javascript; charset=utf-8"); return res.end(script); }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<!doctype html><html><head><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : undefined), headless: true });
const content = "完整消息 full message\nSecond paragraph, not just a selection.";
const code = 'const whole = "完整代码";\nconsole.log(whole);';
try {
  for (const fallback of [false, true]) {
    const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
    const page = await context.newPage();
    const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript((fallback) => {
      localStorage.setItem("pi-locale", "en");
      window.seedClipboard = navigator.clipboard.writeText.bind(navigator.clipboard);
      if (fallback) navigator.clipboard.writeText = async () => { throw new DOMException("Blocked for fallback test", "NotAllowedError"); };
    }, fallback);
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForSelector("#direct");
    const select = () => page.evaluate(() => {
      const range = document.createRange(); range.selectNodeContents(document.querySelector("#selected"));
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    });
    const check = async (button, expected) => {
      await page.evaluate(() => window.seedClipboard("clipboard sentinel"));
      const message = button.locator("xpath=ancestor::*[@data-message-role or contains(concat(' ', normalize-space(@class), ' '), ' message-user ')][1]");
      if (await message.count()) await message.hover();
      await button.click();
      await page.waitForFunction(async (expected) => await navigator.clipboard.readText() === expected, expected, { timeout: 5000 });
    };
    for (const selected of [false, true]) {
      if (selected) await select();
      await check(page.locator('#assistant button[title="Copy message"]'), content + '\n\n```js\n' + code + '\n```');
      if (selected) await select();
      await check(page.locator('#user button[title="Copy message"]'), content);
      if (selected) await select();
      await check(page.locator('#assistant .markdown-code-action').filter({ hasText: /^Copy$/ }), code);
    }
    // Preserve document selection and input focus when the execCommand fallback runs.
    await select();
    await check(page.locator("#direct"), content);
    assert.equal(await page.evaluate(() => window.getSelection().toString()), "Only selected text");
    await page.locator("#input").focus();
    await page.evaluate(() => document.querySelector("#input").setSelectionRange(1, 5));
    await page.locator("#direct").evaluate((button) => button.click());
    assert.deepEqual(await page.locator("#input").evaluate((input) => [document.activeElement === input, input.selectionStart, input.selectionEnd]), [true, 1, 5]);
    await page.evaluate(() => { document.querySelector("#modal").showModal(); document.querySelector("#modal input").select(); });
    await check(page.locator("#modal-copy"), content);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("PASS: actual message/code copy buttons copy all text with or without selections; Clipboard API and fallback; modal dialogs and focus restoration");
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
