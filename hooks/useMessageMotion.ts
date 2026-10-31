"use client";
import { useLayoutEffect, useRef } from "react";
import { readChatEffect, useChatEffect } from "./useChatEffects";

type Submission = { box: DOMRect; text: string; at: number; sentAt: number };
const submissions = new WeakMap<Element, Submission>();

/** Capture after reference resolution, immediately before the single existing send. */
export function captureMessageMotion(input: HTMLTextAreaElement | null, text: string) {
  const root = input?.closest(".chat-window");
  if (!root || !input) return;
  submissions.delete(root);
  if (readChatEffect("messageMotion") === "off" || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  submissions.set(root, { box: input.getBoundingClientRect(), text: text.replace(/\r\n?/g, "\n"), at: performance.now(), sentAt: Date.now() });
}
export function useMessageMotion(text: string, timestamp: string | number | undefined) {
  const ref = useRef<HTMLDivElement>(null);
  const claimed = useRef<{ root: Element; submission: Submission } | null>(null);
  const mode = useChatEffect("messageMotion");
  useLayoutEffect(() => {
    const bubble = ref.current, root = bubble?.closest(".chat-window");
    const submission = root && (submissions.get(root) ?? (claimed.current?.root === root ? claimed.current.submission : undefined));
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const createdAt = typeof timestamp === "number" ? timestamp : Date.parse(timestamp ?? "");
    if (!bubble || !root || !submission || submission.text !== text || performance.now() - submission.at > 5000
      || !Number.isFinite(createdAt) || createdAt < submission.sentAt) return;
    submissions.delete(root);
    claimed.current = { root, submission };
    if (mode === "off" || motion.matches) { claimed.current = null; return; }
    let frame = 0, animation: Animation | undefined, ghost: HTMLElement | undefined;
    const clear = () => { animation?.cancel(); ghost?.remove(); bubble.style.removeProperty("visibility"); };
    // Hide before the first paint: showing the destination for two frames
    // before the flight makes the movement look like a faint duplicate.
    if (mode === "flight") bubble.style.visibility = "hidden";
    // The scroll anchor settles after the new message commits.
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (!bubble.isConnected || motion.matches) { clear(); return; }
        claimed.current = null;
        const target = bubble.getBoundingClientRect();
        if (!target.width || !target.height) { clear(); return; }
        if (mode === "grow") {
          animation = bubble.animate([{ transform: "scale(0.2)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }],
            { duration: 300, easing: "cubic-bezier(.22,.8,.3,1)" });
          return;
        }
        ghost = bubble.cloneNode(true) as HTMLElement;
        ghost.classList.add("message-flight-ghost");
        ghost.style.removeProperty("visibility");
        ghost.setAttribute("aria-hidden", "true"); ghost.inert = true;
        ghost.removeAttribute("id");
        ghost.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
        Object.assign(ghost.style, { left: `${target.left}px`, top: `${target.top}px`, width: `${target.width}px`, height: `${target.height}px` });
        document.body.append(ghost);
        bubble.style.visibility = "hidden";
        const source = submission.box;
        animation = ghost.animate([
          { left: `${source.left}px`, top: `${source.top}px`, width: `${source.width}px`, height: `${Math.min(source.height, target.height)}px`, opacity: .9, offset: 0 },
          { left: `${source.left + (target.left - source.left) * .7}px`, top: `${Math.min(source.top, target.top) - 28}px`, width: `${target.width}px`, height: `${target.height}px`, opacity: 1, offset: .7 },
          { left: `${target.left}px`, top: `${target.top}px`, width: `${target.width}px`, height: `${target.height}px`, opacity: 1, offset: 1 },
        ], { duration: 680, easing: "cubic-bezier(.25,.6,.3,1)" });
        animation.onfinish = clear;
      });
    });
    motion.addEventListener("change", clear);
    return () => { cancelAnimationFrame(frame); motion.removeEventListener("change", clear); clear(); };
  }, [mode, text, timestamp]);
  return ref;
}
