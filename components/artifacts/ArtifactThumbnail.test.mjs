import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// List thumbnails render history without the user asking, so they must never
// run an artifact's code: the HTML frame gets an empty sandbox (no scripts,
// forms, popups or same-origin), and SVG/Mermaid go through <img>.
test("the thumbnail frame is sandboxed with no permissions", async () => {
  const source = await readFile(new URL("./ArtifactThumbnail.tsx", import.meta.url), "utf8");
  assert.match(source, /<iframe[\s\S]*?sandbox=""[\s\S]*?\/>/);
  assert.doesNotMatch(source, /allow-(scripts|same-origin|forms|popups)/);
  assert.match(source, /<img className="artifacts-thumb-image" src=\{svgImageSource\(svg\)\}/);
});
