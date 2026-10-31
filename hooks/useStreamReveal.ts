"use client";
import { useEffect, useRef } from "react";
import { useChatEffect } from "./useChatEffects";

const fading = new Map<Range, number>();
let frame = 0;
function api() {
  return { registry: CSS.highlights, Highlight: window.Highlight };
}
function paint(now: number) {
  frame = 0;
  const { registry, Highlight } = api();
  if (!registry || !Highlight) return;
  const steps: Range[][] = Array.from({ length: 8 }, () => []);
  for (const [range, started] of fading) {
    // RAF timestamps mark the start of the frame; a mutation can be newer.
    const age = Math.max(0, now - started);
    if (age >= 480 || !range.startContainer.isConnected) fading.delete(range);
    else steps[Math.min(7, Math.floor(age / 60))].push(range);
  }
  steps.forEach((ranges, index) => {
    const name = `pi-stream-reveal-${index}`;
    if (ranges.length) registry.set(name, new Highlight(...ranges));
    else registry.delete(name);
  });
  if (fading.size) frame = requestAnimationFrame(paint);
}

/** Highlight only appended text; Markdown nodes and selection stay intact. */
export function useStreamReveal(streaming: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const enabled = useChatEffect("streamReveal") === "on";
  useEffect(() => {
    const root = ref.current;
    if (!root || !streaming || !enabled || !api().Highlight || !api().registry) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const owned = new Set<Range>();
    let previous = "";
    let suffixes: { start: number; end: number; born: number }[] = [];
    const scan = (animate: boolean) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => node.parentElement?.closest("button, style, script, [aria-hidden=true]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
      });
      const nodes: Text[] = [];
      while (walker.nextNode()) nodes.push(walker.currentNode as Text);
      const text = nodes.map((node) => node.data).join("");
      let prefix = 0;
      while (prefix < previous.length && prefix < text.length && previous[prefix] === text[prefix]) prefix++;
      const now = performance.now();
      // Keep birth times by text offset: Streamdown can retire/rebuild word
      // spans before our fade finishes. Rebind ranges without restarting it.
      suffixes = prefix < previous.length || motion.matches ? [] : suffixes.filter((item) => now - item.born < 480);
      if (animate && !motion.matches && prefix >= previous.length && text.length > prefix) {
        suffixes.push({ start: prefix, end: text.length, born: now });
      }
      for (const range of owned) fading.delete(range);
      owned.clear();
      let offset = 0;
      for (const node of nodes) {
        for (const item of suffixes) {
          const start = Math.max(item.start, offset), end = Math.min(item.end, offset + node.length);
          if (end <= start) continue;
          const range = document.createRange();
          range.setStart(node, start - offset);
          range.setEnd(node, end - offset);
          fading.set(range, item.born); owned.add(range);
        }
        offset += node.length;
      }
      if (owned.size && !frame) frame = requestAnimationFrame(paint);
      previous = text;
    };
    const clear = () => {
      for (const range of owned) fading.delete(range);
      owned.clear();
      suffixes = [];
      if (frame) cancelAnimationFrame(frame);
      paint(performance.now());
    };
    scan(false);
    const observer = new MutationObserver(() => scan(true));
    observer.observe(root, { childList: true, characterData: true, subtree: true });
    motion.addEventListener("change", clear);
    return () => { observer.disconnect(); motion.removeEventListener("change", clear); clear(); };
  }, [enabled, streaming]);
  return ref;
}
