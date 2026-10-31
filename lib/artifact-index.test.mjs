import assert from "node:assert/strict";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getArtifact, listArtifacts, parseSessionArtifacts, resetArtifactIndexForTests } from "./artifact-index.ts";

function artifact(identifier, title, body, type = "html") {
  return `Here it is.\n\n:::artifact{identifier="${identifier}" type="${type}" title="${title}"}\n\`\`\`${type}\n${body}\n\`\`\`\n:::\n`;
}

function assistant(id, parentId, text, timestamp = "2026-10-01T00:00:00.000Z") {
  return { type: "message", id, parentId, timestamp, message: { role: "assistant", content: [{ type: "text", text }] } };
}

function user(id, parentId, text) {
  return { type: "message", id, parentId, timestamp: "2026-10-01T00:00:00.000Z", message: { role: "user", content: text } };
}

function lines(entries) {
  return [{ type: "session", id: "header", cwd: "/tmp" }, ...entries].map((entry) => JSON.stringify(entry)).join("\n") + "\n";
}

function fixture(t, entries, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-artifact-index-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "session.jsonl");
  writeFileSync(path, lines(entries));
  return { id: "session", path, cwd: "/project", projectKey: "/project", created: "2026-10-01", modified: "2026-10-01", firstMessage: "first", messageCount: entries.length, ...overrides };
}

test.beforeEach(() => resetArtifactIndexForTests());

test("collects versions in file order and marks the branch the file ends on", () => {
  const parsed = parseSessionArtifacts(lines([
    user("u1", null, "make a page"),
    assistant("a1", "u1", artifact("page", "Page v1", "<p>one</p>")),
    user("u2", "a1", "change it"),
    assistant("a2", "u2", artifact("page", "Page v2", "<p>two</p>")),
    // Re-edited u2: a sibling branch, which the file now ends on.
    user("u3", "a1", "change it differently"),
    assistant("a3", "u3", artifact("page", "Page v3", "<p>three</p>")),
  ]));
  assert.equal(parsed.length, 1);
  assert.deepEqual(parsed[0].versions.map((version) => [version.title, version.entryId, version.onActiveBranch]), [
    ["Page v1", "a1", true],
    ["Page v2", "a2", false],
    ["Page v3", "a3", true],
  ]);
});

test("follows the branch through entries whose keys come in another order", () => {
  const parsed = parseSessionArtifacts(lines([
    assistant("a1", null, artifact("page", "Page", "<p>one</p>")),
    { type: "custom", customType: "note", data: { id: "not-the-entry" }, id: "c1", parentId: "a1" },
    user("u2", "c1", "thanks"),
  ]));
  assert.equal(parsed[0].versions[0].onActiveBranch, true);
});

test("streams a file too large to read whole", async (t) => {
  const session = fixture(t, [
    assistant("a1", null, artifact("page", "Big session page", "<p>one</p>")),
    { type: "message", id: "t1", parentId: "a1", message: { role: "toolResult", content: [{ type: "text", text: "x".repeat(17 * 1024 * 1024) }] } },
  ]);
  const found = await getArtifact(session, "page");
  assert.equal(found.versions[0].title, "Big session page");
  assert.equal(found.versions[0].onActiveBranch, true);
});

test("ignores artifact syntax outside assistant text", () => {
  const parsed = parseSessionArtifacts(lines([
    user("u1", null, artifact("quoted", "Quoted", "<p>x</p>")),
    { type: "message", id: "t1", parentId: "u1", message: { role: "toolResult", content: [{ type: "text", text: artifact("tool", "Tool", "x") }] } },
    { type: "message", id: "a1", parentId: "t1", message: { role: "assistant", content: [{ type: "thinking", thinking: artifact("think", "Think", "x") }] } },
  ]));
  assert.deepEqual(parsed, []);
});

test("lists newest first and searches identifier, title, then content", async (t) => {
  const one = fixture(t, [
    assistant("a1", null, artifact("chart", "Sales chart", "<svg><text>revenue</text></svg>", "svg"), "2026-10-02T00:00:00.000Z"),
  ], { id: "one" });
  const two = fixture(t, [
    assistant("b1", null, artifact("notes", "Meeting notes", "# Agenda\nquarterly revenue review", "markdown"), "2026-10-03T00:00:00.000Z"),
  ], { id: "two", cwd: "/other", projectKey: "/other", workspaceKind: "chat" });

  const all = await listArtifacts([one, two]);
  assert.deepEqual(all.artifacts.map((item) => item.identifier), ["notes", "chart"]);
  assert.equal(all.artifacts[0].workspaceKind, "chat");
  assert.equal(all.truncated, false);

  const byTitle = await listArtifacts([one, two], "SALES");
  assert.deepEqual(byTitle.artifacts.map((item) => item.identifier), ["chart"]);
  assert.equal(byTitle.artifacts[0].snippet, undefined);

  const byContent = await listArtifacts([one, two], "quarterly");
  assert.deepEqual(byContent.artifacts.map((item) => item.identifier), ["notes"]);
  assert.deepEqual(byContent.artifacts[0].snippet, { before: "# Agenda ", match: "quarterly", after: " revenue review" });

  assert.deepEqual((await listArtifacts([one, two], "(a+)+$")).artifacts, []);
});

test("hides a fork's copies of its source's artifacts but keeps new versions", async (t) => {
  const sourceEntries = [assistant("a1", null, artifact("page", "Page", "<p>one</p>"))];
  const source = fixture(t, sourceEntries, { id: "source" });
  const copy = fixture(t, sourceEntries, { id: "copy", relation: { kind: "fork" }, parentSessionId: "source" });
  const grown = fixture(t, [
    ...sourceEntries,
    assistant("a2", "a1", artifact("page", "Page", "<p>two</p>"), "2026-10-05T00:00:00.000Z"),
  ], { id: "grown", relation: { kind: "fork" }, parentSessionId: "source" });

  const listed = await listArtifacts([source, copy, grown]);
  assert.deepEqual(listed.artifacts.map((item) => [item.sessionId, item.versionCount]), [["grown", 2], ["source", 1]]);
});

test("skips subagent sessions and flags scheduled runs and active content", async (t) => {
  const subagent = fixture(t, [assistant("a1", null, artifact("sub", "Sub", "<p>x</p>"))], {
    id: "sub",
    relation: { kind: "subagent", parentSessionId: "p", profile: "x", description: "", status: "done" },
  });
  const scheduled = fixture(t, [assistant("a1", null, artifact("daily", "Daily", "<script>run()</script>"))], {
    id: "run",
    relation: { kind: "scheduled", taskId: "t", runId: "r" },
  });
  const listed = await listArtifacts([subagent, scheduled]);
  assert.deepEqual(listed.artifacts.map((item) => [item.identifier, item.scheduled, item.activeContent]), [["daily", true, true]]);
});

test("re-reads a file only when its fingerprint changes", async (t) => {
  const session = fixture(t, [assistant("a1", null, artifact("page", "Old", "<p>x</p>"))]);
  assert.equal((await getArtifact(session, "page")).versions[0].title, "Old");

  writeFileSync(session.path, lines([assistant("a1", null, artifact("page", "New title", "<p>x</p>"))]));
  utimesSync(session.path, new Date(), new Date(Date.now() + 5000));
  assert.equal((await getArtifact(session, "page")).versions[0].title, "New title");
  assert.equal(await getArtifact(session, "missing"), null);
  assert.equal(await getArtifact({ ...session, transient: true }, "page"), null);
});
