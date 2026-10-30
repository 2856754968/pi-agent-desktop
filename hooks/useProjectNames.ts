"use client";

import { useMemo, useSyncExternalStore } from "react";
import { APP_PREF_KEYS, getPref, removePref, setPrefJson } from "@/lib/app-prefs";
import { parseProjectNames, projectNameKey } from "@/lib/project-display";

const eventName = "pi-project-names-changed";
function subscribe(callback: () => void) {
  window.addEventListener(eventName, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(eventName, callback);
    window.removeEventListener("storage", callback);
  };
}
const snapshot = () => getPref(APP_PREF_KEYS.projectNames);

export function useProjectNames() {
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  const names = useMemo(() => parseProjectNames(raw), [raw]);
  return { names, renameProject: (path: string, value: string) => {
    // Read fresh storage so a second mounted surface cannot overwrite a rename.
    const next = { ...parseProjectNames(snapshot()) };
    const key = projectNameKey(path);
    const name = value.trim().slice(0, 100);
    if (name) Object.defineProperty(next, key, { value: name, enumerable: true, configurable: true });
    else delete next[key];
    if (Object.keys(next).length) setPrefJson(APP_PREF_KEYS.projectNames, next);
    else removePref(APP_PREF_KEYS.projectNames);
    window.dispatchEvent(new Event(eventName));
  } };
}
