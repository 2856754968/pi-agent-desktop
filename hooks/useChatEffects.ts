"use client";
import { useSyncExternalStore } from "react";
import { APP_PREF_KEYS, getPref, setPref } from "@/lib/app-prefs";

const choices = {
  caretMotion: ["on", "off"],
  streamReveal: ["on", "off"],
  messageMotion: ["flight", "grow", "off"],
  contextDisplay: ["band", "ramp", "pie"],
  contextPercent: ["off", "on"],
} as const;
export type ChatEffectKey = keyof typeof choices;
export type ChatEffectValue<K extends ChatEffectKey> = (typeof choices)[K][number];
const eventName = "pi-chat-effects-changed";
function subscribe(callback: () => void) {
  window.addEventListener(eventName, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(eventName, callback);
    window.removeEventListener("storage", callback);
  };
}
export function readChatEffect<K extends ChatEffectKey>(key: K): ChatEffectValue<K> {
  const value = getPref(APP_PREF_KEYS[key]);
  return (choices[key] as readonly string[]).includes(value ?? "")
    ? value as ChatEffectValue<K> : choices[key][0];
}
export function setChatEffect<K extends ChatEffectKey>(key: K, value: ChatEffectValue<K>) {
  if (!(choices[key] as readonly string[]).includes(value)) return;
  setPref(APP_PREF_KEYS[key], value);
  window.dispatchEvent(new Event(eventName));
}
export function useChatEffect<K extends ChatEffectKey>(key: K): ChatEffectValue<K> {
  return useSyncExternalStore(subscribe, () => readChatEffect(key), () => choices[key][0]);
}
