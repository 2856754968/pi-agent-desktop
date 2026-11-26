import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { getRunningPiSubagents, getToolExecutionProgress } = await jiti.import("./tool-execution-progress.ts");

test("counts live pi-subagents from progress and workflow inventories", () => {
  assert.equal(getRunningPiSubagents({ details: { progress: [{ status: "running" }] } }), 1);
  const children = [{ state: "running" }, { state: "running" }, { state: "pending" }, { state: "completed" }];
  assert.equal(getRunningPiSubagents({ details: { workflowChildren: { children } } }), 2);
  assert.equal(getRunningPiSubagents({ details: { workflowChildren: { children: children.slice(2) } } }), 0);
  assert.equal(getRunningPiSubagents({ details: { progress: [{ status: "completed" }] } }), 0);
  assert.equal(getRunningPiSubagents({ details: {} }), undefined);
});

test("uses the latest non-empty text line from a partial tool result", () => {
  assert.equal(getToolExecutionProgress({
    content: [
      { type: "text", text: "Phase 1 complete\n" },
      { type: "image", data: "ignored" },
      { type: "text", text: "\nProcessing item 4 of 10\n" },
    ],
  }), "Processing item 4 of 10");
});

test("ignores partial tool results without displayable text", () => {
  assert.equal(getToolExecutionProgress(null), null);
  assert.equal(getToolExecutionProgress({ content: [{ type: "image" }] }), null);
  assert.equal(getToolExecutionProgress({ content: [{ type: "text", text: "  \n" }] }), null);
});

test("bounds long progress lines while preserving the latest text", () => {
  const progress = getToolExecutionProgress({
    content: [{ type: "text", text: `prefix-${"x".repeat(600)}-latest` }],
  });

  assert.equal(progress.length, 500);
  assert.match(progress, /^\.\.\./);
  assert.match(progress, /-latest$/);
});
