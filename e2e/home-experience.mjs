import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

const out = "test-results/home-experience";
await mkdir(out, { recursive: true });
await build({ entryPoints: ["e2e/home-experience.fixture.tsx"], bundle: true, platform: "browser", format: "iife",
  outfile: out + "/fixture.js", define: { "process.env.NODE_ENV": '"production"' }, jsx: "automatic", logLevel: "warning" });
const js = await readFile(out + "/fixture.js");
const css = (await Promise.all(["app/globals.css", "app/settings.css", "app/native-theme.css"].map((p) => readFile(p, "utf8"))))
  .map((text) => text.replace(/^@import[^;]*;/gm, "")).join("\n") +
  "\n*{box-sizing:border-box}body{margin:0}main{padding:16px;max-width:900px;margin:auto}.home-fixture-stage{display:flex;height:470px}.home-fixture-composer{position:relative;margin:40px auto 0;max-width:820px}textarea{width:100%;height:70px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:16px}";
const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/fixture.js" ? "text/javascript" : req.url === "/style.css" ? "text/css" : "text/html; charset=utf-8");
  res.end(req.url === "/fixture.js" ? js : req.url === "/style.css" ? css : '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
const data = { sessions: 12, messages: 50, tokens: 12340, activeDays: 4, peakHour: 8,
  favoriteModel: "provider/example-model", days: [{ date: "2026-10-29", messages: 50, tokens: 12340 }],
  models: [{ name: "provider/example-model", tokens: 12340 }], usageRecords: 25, skippedFiles: 0, generatedAt: "2026-10-30T12:00:00Z" };
try {
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    let requests = 0, fail = false;
    await page.route("**/api/home-usage?*", async (route) => {
      requests++;
      await route.fulfill({ status: fail ? 500 : 200, contentType: "application/json", body: JSON.stringify(data) });
    });
    await page.goto("http://127.0.0.1:" + server.address().port);
    await page.evaluate((theme) => document.documentElement.classList.toggle("dark", theme === "dark"), theme);
    await page.getByRole("switch", { name: "Pixel crab companion" }).waitFor();
    assert.equal(requests, 0, "disabled dashboard does not read session history");
    assert.equal(await page.locator(".composer-companion").count(), 0);
    await page.getByRole("switch", { name: "Pixel crab companion" }).click();
    await page.locator('.composer-companion[data-state="idle"]').waitFor();
    for (const state of ["thinking", "working", "attention", "error"]) {
      await page.getByRole("button", { name: state, exact: true }).click();
      await page.locator('.composer-companion[data-state="' + state + '"]').waitFor();
    }
    await page.getByRole("button", { name: "working", exact: true }).click();
    await page.getByRole("button", { name: "idle", exact: true }).click();
    await page.locator('.composer-companion[data-state="done"]').waitFor();
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(await page.locator(".composer-companion").evaluate((el) => getComputedStyle(el).animationName), "none");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.getByRole("switch", { name: "Home usage dashboard" }).click();
    await page.getByText("12,340", { exact: true }).waitFor();
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.equal(await page.locator(".home-usage").evaluate((el) => el.scrollWidth > el.clientWidth + 1), false);
      await page.screenshot({ path: out + "/" + theme + "-" + width + ".png" });
    }
    await page.getByRole("button", { name: "Models", exact: true }).click();
    await page.getByRole("meter", { name: "provider/example-model" }).waitFor();
    fail = true;
    await page.getByRole("button", { name: "7 days", exact: true }).click();
    await page.getByRole("alert").waitFor();
    fail = false;
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await page.getByRole("meter").waitFor();
    await page.reload();
    await page.getByText("12,340", { exact: true }).waitFor();
    assert.equal(await page.getByRole("switch", { name: "Home usage dashboard" }).getAttribute("aria-checked"), "true");
    await page.getByRole("switch", { name: "Home usage dashboard" }).click();
    await page.locator(".home-usage").waitFor({ state: "detached" });
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log("PASS home experience: opt-in, local preferences, light/dark, 320–1280px, states, reduced motion, metrics, models and error/retry.");
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
