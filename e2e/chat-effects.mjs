import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";
const out = "test-results/chat-effects";
await mkdir(out, { recursive: true });
await build({ entryPoints: ["e2e/chat-effects.fixture.tsx"], bundle: true, platform: "browser", format: "iife", outfile: out + "/fixture.js",
  define: { "process.env": '{"NODE_ENV":"production"}' }, jsx: "automatic", logLevel: "warning" });
const js = await readFile(out + "/fixture.js");
const css = (await Promise.all(["app/globals.css", "app/settings.css", "app/native-theme.css"].map((p) => readFile(p, "utf8")))).map((s) => s.replace(/^@import[^;]*;/gm, "")).join("\n") +
  "\n*{box-sizing:border-box}body{margin:0}main{max-width:900px;margin:auto;padding:16px}";
const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/fixture.js" ? "text/javascript" : req.url === "/style.css" ? "text/css" : "text/html; charset=utf-8");
  res.end(req.url === "/fixture.js" ? js : req.url === "/style.css" ? css : '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : undefined), headless: true });
try {
  for (const theme of ["light", "dark"]) for (const width of [1280, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 1100 } });
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript((theme) => { localStorage.setItem("pi-locale", "zh-CN"); document.addEventListener("DOMContentLoaded", () => document.documentElement.classList.toggle("dark", theme === "dark")); }, theme);
    await page.goto("http://127.0.0.1:" + server.address().port);
    await page.getByRole("combobox", { name: "上下文占用图示", exact: true }).click();
    await page.getByRole("option", { name: "饼图", exact: true }).click();
    await page.locator("#context .context-usage-pie").waitFor();
    await page.getByRole("switch", { name: "显示上下文百分比", exact: true }).click();
    assert.equal(await page.locator("#context .context-usage-percent").textContent(), "72%");
    assert.equal(await page.locator("#unknown-context .context-usage-percent").textContent(), "—");
    for (const name of ["圆环 · 绿到红", "圆环 · 蓝黄红"]) {
      await page.getByRole("combobox", { name: "上下文占用图示", exact: true }).click();
      await page.getByRole("option", { name, exact: true }).click();
      assert.equal(await page.locator("#context svg circle").count(), 2);
    }
    await page.locator(".model-selector > button").click();
    await page.locator(".model-option-description").first().waitFor();
    assert.equal(await page.locator(".model-option-description").count(), 2);
    assert.ok((await page.locator(".model-option-description").first().textContent()).length > 5);
    await page.screenshot({ path: out + "/models-" + theme + "-" + width + ".png" });
    await page.keyboard.press("Escape");
    const input = page.locator(".chat-input-textarea");
    await input.scrollIntoViewIfNeeded();
    await input.fill("多行输入\n第二行");
    await page.waitForFunction(() => document.querySelector(".chat-input-textarea")?.hasAttribute("data-animated-caret"));
    await page.waitForFunction(() => { const el = document.querySelector('.composer-animated-caret'); return el && !el.hidden && el.getBoundingClientRect().height > 0; });
    await input.dispatchEvent("compositionstart");
    assert.equal(await input.getAttribute("data-animated-caret"), null);
    await input.dispatchEvent("compositionend");
    await page.waitForFunction(() => document.querySelector(".chat-input-textarea")?.hasAttribute("data-animated-caret"));
    // Keep this single-line at 320px too: wrapped text can scroll the caret
    // out of view, where the component deliberately falls back to native input.
    await input.fill("Caret");
    await page.waitForTimeout(180);
    assert.equal(await page.locator(".composer-animated-caret").evaluate((el) => getComputedStyle(el).width), "3px");
    await input.press("Home");
    await page.waitForFunction(() => {
      const caret = document.querySelector(".composer-animated-caret");
      return caret?.getAnimations().some((animation) => animation instanceof CSSTransition && animation.transitionProperty === "transform");
    });
    await input.fill("Fly this message");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page.locator(".message-flight-ghost").waitFor();
    const flight = await page.locator(".message-flight-ghost").evaluate((el) => {
      const animation = el.getAnimations()[0];
      return { duration: animation.effect.getTiming().duration, frames: animation.effect.getKeyframes().length,
        opacity: getComputedStyle(el).opacity };
    });
    assert.equal(flight.duration, 680);
    assert.equal(flight.frames, 3);
    assert.ok(Number(flight.opacity) >= .85);
    await page.screenshot({ path: out + "/" + theme + "-" + width + ".png" });
    await page.locator(".message-flight-ghost").waitFor({ state: "detached" });
    assert.equal(await page.locator(".message-user-bubble", { hasText: "Fly this message" }).count(), 1);
    await page.getByRole("button", { name: "Append stream", exact: true }).click();
    await page.waitForFunction(() => [...CSS.highlights.keys()].some((key) => key.startsWith("pi-stream-reveal-")));
    assert.equal(await page.locator("#stream .stream-char").evaluateAll((els) => els.every((el) => getComputedStyle(el).animationName === "none")), true);
    await page.waitForFunction(() => document.querySelector("#stream")?.textContent?.includes("新到的文字"));
    assert.equal(await page.locator("#stream strong").textContent(), "Markdown");
    // The renderer retires its word spans at 180ms. The longer reveal must
    // still cover connected text after that DOM change, rather than cut short.
    await page.waitForTimeout(220);
    assert.ok(await page.evaluate(() => [...CSS.highlights.entries()]
      .filter(([name]) => name.startsWith("pi-stream-reveal-"))
      .some(([, highlight]) => [...highlight].some((range) => range.startContainer.isConnected && range.toString().length > 0))));
    // Capture after the timing assertion so screenshot latency cannot consume
    // the 480ms reveal window before the 220ms DOM-retirement check.
    await page.screenshot({ path: out + "/reveal-" + theme + "-" + width + ".png" });
    await page.getByRole("switch", { name: "流式文字淡入", exact: true }).click();
    await page.waitForFunction(() => ![...CSS.highlights.keys()].some((key) => key.startsWith("pi-stream-reveal-")));
    await page.getByRole("button", { name: "Append stream", exact: true }).click();
    assert.equal(await page.locator("#stream .chat-stream-reveal").count(), 0);
    await page.getByRole("button", { name: "Finish stream", exact: true }).click();
    await page.waitForFunction(() => ![...CSS.highlights.keys()].some((key) => key.startsWith("pi-stream-reveal-")));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await input.fill("No motion");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page.waitForTimeout(100);
    assert.equal(await page.locator(".message-flight-ghost").count(), 0);
    assert.equal(await input.getAttribute("data-animated-caret"), null);
    await page.reload();
    assert.equal(await page.getByRole("combobox", { name: "上下文占用图示", exact: true }).textContent(), "圆环 · 蓝黄红");
    assert.deepEqual(errors, []);
    await page.close();
    console.log(theme + " " + width + ": effects and persistence passed");
  }
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
