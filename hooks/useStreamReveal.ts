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
    let entries: { node: Text; data: string; start: number }[] = [];
    let length = 0;
    let suffixes: { start: number; end: number; born: number }[] = [];
    const scan = (animate: boolean, records: MutationRecord[] = []) => {
      const previousLength = length;
      const tail = entries.at(-1);
      // A plain tail append keeps every earlier node and offset intact. Markdown
      // rewrites take the full snapshot path so retired spans retain birth times.
      const appended = tail && records.length > 0
        && records.every(record => record.type === "characterData" && record.target === tail.node)
        && tail.node.data.startsWith(tail.data);
      let prefix = previousLength;
      if (appended) {
        tail.data = tail.node.data;
        length = tail.start + tail.data.length;
      } else {
        const previous = entries.map(entry => entry.data).join("");
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
          acceptNode: (node) => node.parentElement?.closest("button, style, script, [aria-hidden=true]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
        });
        entries = [];
        length = 0;
        while (walker.nextNode()) {
          const node = walker.currentNode as Text;
          entries.push({ node, data: node.data, start: length });
          length += node.length;
        }
        const text = entries.map(entry => entry.data).join("");
        if (!text.startsWith(previous)) {
          prefix = 0;
          while (prefix < previousLength && prefix < length && previous[prefix] === text[prefix]) prefix++;
        }
      }
      const now = performance.now();
      // Keep birth times by text offset: Streamdown can retire/rebuild word
      // spans before our fade finishes. Rebind ranges without restarting it.
      suffixes = prefix < previousLength || motion.matches ? [] : suffixes.filter((item) => now - item.born < 480);
      if (animate && !motion.matches && prefix >= previousLength && length > prefix) {
        suffixes.push({ start: prefix, end: length, born: now });
      }
      for (const range of owned) fading.delete(range);
      owned.clear();
      for (const item of suffixes) {
        // Locate the fading suffix without visiting the answer's stable prefix.
        let low = 0, high = entries.length;
        while (low < high) {
          const middle = (low + high) >>> 1;
          const entry = entries[middle];
          if (entry.start + entry.data.length <= item.start) low = middle + 1;
          else high = middle;
        }
        for (let index = low; index < entries.length; index++) {
          const { node, start: offset, data } = entries[index];
          if (offset >= item.end) break;
          const start = Math.max(item.start, offset), end = Math.min(item.end, offset + data.length);
          if (end <= start) continue;
          const range = document.createRange();
          range.setStart(node, start - offset);
          range.setEnd(node, end - offset);
          fading.set(range, item.born); owned.add(range);
        }
      }
      if (owned.size && !frame) frame = requestAnimationFrame(paint);
    };
    const clear = () => {
      for (const range of owned) fading.delete(range);
      owned.clear();
      suffixes = [];
      if (frame) cancelAnimationFrame(frame);
      paint(performance.now());
    };
    scan(false);
    const observer = new MutationObserver(records => scan(true, records));
    observer.observe(root, { childList: true, characterData: true, subtree: true });
    motion.addEventListener("change", clear);
    return () => { observer.disconnect(); motion.removeEventListener("change", clear); clear(); };
  }, [enabled, streaming]);
  return ref;
}
