import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const storage = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  },
};
// Projects "removed" by builds before the Archive group land in it unchanged.
storage.set("pi-web:archived-projects", JSON.stringify(["/old", 7]));

const jiti = createJiti(import.meta.url);
let disk = { initialized: true, names: {}, archived: ["/old"] };
globalThis.fetch = async (_url, options) => {
  if (options?.body) {
    const change = JSON.parse(options.body);
    disk = { ...disk, archived: disk.archived.filter(root => root !== change.path) };
    if (change.action === "archive") disk.archived.push(change.path);
  }
  return { ok: true, json: async () => structuredClone(disk) };
};
globalThis.window.addEventListener = () => {};
globalThis.window.removeEventListener = () => {};
const prefs = await jiti.import("./project-preferences-client.ts");
const unsubscribe = prefs.subscribeProjectPreferences(() => {});
await new Promise(resolve => setTimeout(resolve, 0));
unsubscribe();
const {
  archiveProjectRoot,
  archivedProjectRootFor,
  readArchivedProjects,
  restoreProjectRoot,
  setArchiveExpanded,
} = await jiti.import("./archived-projects.ts");

test("archive and restore keep the stored list and a stable snapshot", () => {
  const first = readArchivedProjects();
  assert.deepEqual([...first], ["/old"]);
  assert.equal(readArchivedProjects(), first, "unchanged reads return the same Set");

  archiveProjectRoot("/repo");
  const second = readArchivedProjects();
  assert.notEqual(second, first);
  assert.deepEqual(JSON.parse(storage.get("pi-web:archived-projects")), ["/old", "/repo"]);
  archiveProjectRoot("/repo");
  assert.equal(readArchivedProjects(), second, "archiving twice is a no-op");

  assert.equal(restoreProjectRoot("/missing"), false);
  assert.equal(restoreProjectRoot("/repo"), true);
  assert.equal(restoreProjectRoot("/old"), true);
  assert.deepEqual(JSON.parse(storage.get("pi-web:archived-projects")), [], "the disk-backed cache records an empty archive");
});

test("a worktree cwd maps to its archived project through the session list", () => {
  const archived = new Set(["/repo"]);
  const sessions = [
    { cwd: "/repo-worktrees/feature", projectRoot: "/repo" },
    { cwd: "/other", projectRoot: null },
  ];
  assert.equal(archivedProjectRootFor("/repo", sessions, archived), "/repo");
  assert.equal(archivedProjectRootFor("/repo-worktrees/feature", sessions, archived), "/repo");
  assert.equal(archivedProjectRootFor("/other", sessions, archived), null);
  assert.equal(archivedProjectRootFor("/unknown", sessions, archived), null);
});

test("the Archive group stores only its unfolded state", () => {
  setArchiveExpanded(true);
  assert.equal(storage.get("pi-web:archive-expanded"), "1");
  setArchiveExpanded(false);
  assert.equal(storage.has("pi-web:archive-expanded"), false);
});
