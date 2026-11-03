"use client";

// Both shell entry points share the disk-backed project preferences store.
import { useSyncExternalStore } from "react";
import { APP_PREF_KEYS, getPref, removePref, setPref } from "./app-prefs";
import { projectNameKey } from "./project-display";
import { subscribeProjectPreferences, projectPreferencesSnapshot, updateProjectPreferences } from "./project-preferences-client";

const EMPTY: ReadonlySet<string> = new Set();
let previous: readonly string[] | undefined;
let cached: ReadonlySet<string> = EMPTY;
export function readArchivedProjects(): ReadonlySet<string> {
  const archived = projectPreferencesSnapshot().archived;
  if (archived !== previous) { previous = archived; cached = new Set(archived); }
  return cached;
}
function contains(archived: ReadonlySet<string>, path: string): boolean {
  const key = projectNameKey(path);
  return [...archived].some(root => projectNameKey(root) === key);
}
export function archiveProjectRoot(projectRoot: string): void {
  if (!contains(readArchivedProjects(), projectRoot)) updateProjectPreferences({ action: "archive", path: projectRoot });
}
export function restoreProjectRoot(projectRoot: string): boolean {
  if (!contains(readArchivedProjects(), projectRoot)) return false;
  updateProjectPreferences({ action: "restore", path: projectRoot });
  return true;
}
export function archivedProjectRootFor(
  cwd: string,
  sessions: readonly { cwd: string; projectRoot?: string | null }[],
  archived: ReadonlySet<string> = readArchivedProjects(),
): string | null {
  if (contains(archived, cwd)) return cwd;
  for (const session of sessions) {
    if (projectNameKey(session.cwd) !== projectNameKey(cwd)) continue;
    const root = session.projectRoot ?? session.cwd;
    if (contains(archived, root)) return root;
  }
  return null;
}
export function useArchivedProjects(): ReadonlySet<string> {
  return useSyncExternalStore(subscribeProjectPreferences, readArchivedProjects, () => EMPTY);
}

// Only the Archive group's fold is local to this browser.
const listeners = new Set<() => void>();
function subscribe(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }
const readArchiveExpanded = () => getPref(APP_PREF_KEYS.archiveExpanded) === "1";
export function useArchiveExpanded(): boolean {
  return useSyncExternalStore(subscribe, readArchiveExpanded, () => false);
}
export function setArchiveExpanded(expanded: boolean): void {
  if (expanded) setPref(APP_PREF_KEYS.archiveExpanded, "1");
  else removePref(APP_PREF_KEYS.archiveExpanded);
  listeners.forEach(cb => cb());
}
