import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src-tauri/src/native_prefs.rs", import.meta.url), "utf8");

function code(text) {
  return text.replace(/^\s*\/\/.*$/gm, "");
}

function functionBody(name) {
  const start = source.indexOf(`fn ${name}(`);
  assert.notEqual(start, -1, `${name} not found`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return code(source.slice(open, i + 1));
  }
  throw new Error(`${name} body not closed`);
}

// On macOS ~/Library/WebKit/<identifier>/WebsiteData holds the origin's
// localStorage (every Settings switch, sidebar state, drafts). The upgrade-time
// cache clear removed it wholesale, so every update reset the user's prefs.
test("version-change cache clear never deletes the WebKit data directory", () => {
  const body = functionBody("clear_webview_caches");
  assert.doesNotMatch(body, /Library\/WebKit/);
  assert.doesNotMatch(body, /dirs_home_dir/);
});

test("macOS cache clear targets the app cache dir", () => {
  const body = functionBody("clear_webview_caches");
  assert.match(body, /target_os = "macos"[\s\S]*app_cache_dir\(\)/);
});
