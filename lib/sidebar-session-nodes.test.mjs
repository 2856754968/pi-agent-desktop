import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { buildSessionTree, countTreeDescendants, treeContainsSession } = await jiti.import("./sidebar-session-nodes.ts");
const {
  MAX_EXPANDED_SUBAGENT_ROWS,
  nextExpandedSubagentRows,
  parseExpandedSubagentRows,
} = await jiti.import("./sidebar-subagent-expansion.ts");

function session(id, modified, extra = {}) {
  return { id, path: `/s/${id}.jsonl`, cwd: "/p", created: modified, modified, messageCount: 1, firstMessage: id, ...extra };
}

const subagent = (parentSessionId) => ({
  parentSessionId,
  relation: { kind: "subagent", parentSessionId, profile: "general", description: "", status: "completed" },
});
const fork = (originSessionId) => ({ parentSessionId: originSessionId, relation: { kind: "fork", originSessionId } });

test("a fork is a row of its own beside its source, not a child of it (#237)", () => {
  const roots = buildSessionTree([
    session("main", "2026-11-14T10:00:00Z"),
    session("fork", "2026-11-14T11:00:00Z", fork("main")),
  ]);
  assert.deepEqual(roots.map((node) => node.session.id), ["fork", "main"]);
  assert.ok(roots.every((node) => node.children.length === 0));
});

test("subagents and side chats nest under their parent; a fork's subagents under the fork", () => {
  const roots = buildSessionTree([
    session("main", "2026-11-14T10:00:00Z"),
    session("a1", "2026-11-14T10:01:00Z", subagent("main")),
    session("side", "2026-11-14T10:02:00Z", { parentSessionId: "main", relation: { kind: "side", parentSessionId: "main" } }),
    session("fork", "2026-11-14T09:00:00Z", fork("main")),
    session("f1", "2026-11-14T09:01:00Z", subagent("fork")),
    session("nested", "2026-11-14T10:03:00Z", subagent("a1")),
  ]);
  assert.deepEqual(roots.map((node) => node.session.id), ["main", "fork"]);
  const [main, forkNode] = roots;
  assert.deepEqual(main.children.map((node) => node.session.id), ["a1", "side"]);
  assert.deepEqual(main.children[0].children.map((node) => node.session.id), ["nested"]);
  assert.deepEqual(forkNode.children.map((node) => node.session.id), ["f1"]);
  assert.equal(countTreeDescendants(main), 3);
  assert.equal(countTreeDescendants(forkNode), 1);
  assert.ok(treeContainsSession(main, "nested"));
  assert.ok(!treeContainsSession(main, "f1"));
});

test("nested activity raises ancestors while a fork remains independent", () => {
  const roots = buildSessionTree([
    session("main", "2026-11-14T08:00:00Z"),
    session("recent", "2026-11-14T11:00:00Z"),
    session("agent", "2026-11-14T09:00:00Z", subagent("main")),
    session("nested", "2026-11-14T12:00:00Z", subagent("agent")),
    session("fork", "2026-11-14T13:00:00Z", fork("main")),
  ]);
  assert.deepEqual(roots.map((node) => node.session.id), ["fork", "main", "recent"]);
  assert.equal(roots[1].session.modified, "2026-11-14T08:00:00Z");
  assert.equal(roots[1].children[0].children[0].session.id, "nested");
});

test("a subagent whose parent is not listed stays visible as a root", () => {
  const roots = buildSessionTree([session("orphan", "2026-11-14T10:00:00Z", subagent("gone"))]);
  assert.deepEqual(roots.map((node) => node.session.id), ["orphan"]);
});

test("unfolded rows are remembered newest last, deduplicated and capped", () => {
  assert.deepEqual(parseExpandedSubagentRows(null), []);
  assert.deepEqual(parseExpandedSubagentRows(["a", 3, "", "b", "a"]), ["a", "b"]);
  assert.deepEqual(nextExpandedSubagentRows(["a", "b"], "a", true), ["b", "a"]);
  assert.deepEqual(nextExpandedSubagentRows(["a", "b"], "a", false), ["b"]);
  const many = Array.from({ length: MAX_EXPANDED_SUBAGENT_ROWS }, (_, index) => `s${index}`);
  const next = nextExpandedSubagentRows(many, "new", true);
  assert.equal(next.length, MAX_EXPANDED_SUBAGENT_ROWS);
  assert.equal(next.at(-1), "new");
  assert.ok(!next.includes("s0"));
});
