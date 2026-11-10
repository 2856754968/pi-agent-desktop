import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import { markdownRemarkPlugins, markdownPreviewRemarkPlugins, markdownRehypePlugins, markdownPreviewRehypePlugins, markdownUrlTransform } from "./markdown.ts";
import { parseFileLine, resolveLocalFileHref } from "./file-links.ts";
import { openFileTab, saveFileViewerState } from "../components/file-tab-state.ts";

test("Windows source links survive both real sanitization pipelines", () => {
  for (const [remarkPlugins, plugins] of [
    [markdownRemarkPlugins, markdownRehypePlugins],
    [markdownPreviewRemarkPlugins, markdownPreviewRehypePlugins],
  ]) {
    for (const input of [
      "D:/workspace/demo.ts:2855", "/D:/workspace/demo.ts:2855",
      "d:/workspace/demo.ts:2855:8", "file:///D:/workspace/demo.ts#L2855",
      "./demo.ts:2855", "./demo.ts#L2855-L2860",
    ]) {
      let target;
      renderToStaticMarkup(React.createElement(Markdown, {
        remarkPlugins, rehypePlugins: plugins, urlTransform: markdownUrlTransform,
        components: { a: ({ href }) => { target = href; return null; } },
      }, `[source](${input})`));
      assert.equal(resolveLocalFileHref(target, "D:/workspace")?.toLowerCase(), "d:/workspace/demo.ts", input);
      assert.equal(parseFileLine(target), 2855, input);
    }
  }
});

test("dangerous URL schemes remain blocked", () => {
  for (const href of ["javascript:alert(1)", "data:text/html,hello", "vbscript:hello"]) {
    let target;
    renderToStaticMarkup(React.createElement(Markdown, {
      remarkPlugins: markdownRemarkPlugins, rehypePlugins: markdownRehypePlugins, urlTransform: markdownUrlTransform,
      components: { a: ({ href }) => { target = href; return null; } },
    }, `[unsafe](<${href}>)`));
    assert.ok(!target, href);
  }
});

test("line parsing ignores invalid locations and PDF pages", () => {
  for (const href of [undefined, "./a.ts", "./a.ts:0", "./a.ts:-2", "./a.pdf#page=12", "./a.ts:999999999999999999"]) {
    assert.equal(parseFileLine(href), undefined);
  }
});

test("reopening a source line reuses the tab but requests a fresh jump", () => {
  const input = { fileName: "a.ts", filePath: "/a.ts", tabId: "file:/a.ts", line: 42 };
  const first = openFileTab([], input);
  const second = openFileTab(first, input);
  assert.equal(second.length, 1);
  assert.equal(second[0].line, 42);
  assert.equal(second[0].viewerRevision, 1);
  const third = openFileTab(second, { ...input, line: 120 });
  assert.equal(third[0].line, 120);
  assert.equal(third[0].viewerRevision, 2);
  const saved = saveFileViewerState(third, input.tabId, 2, {
    displayMode: "source", wrapLines: false, scrollTop: 500, scrollLeft: 0,
  });
  assert.equal(saved[0].line, undefined, "tab restoration must not replay an old line jump");
  assert.equal(saved[0].viewerState.scrollTop, 500);
});
