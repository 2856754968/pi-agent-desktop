"use client";
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { useChatEffect } from "./useChatEffects";

/** Keep editing native; only replace the visible caret after a successful measurement. */
export function useAnimatedCaret(ref: RefObject<HTMLTextAreaElement | null>, value: string) {
  const refresh = useRef<(() => void) | null>(null);
  useLayoutEffect(() => { refresh.current?.(); }, [value]);
  const enabled = useChatEffect("caretMotion") === "on";
  useEffect(() => {
    const input = ref.current;
    if (!enabled || !input) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const mirror = document.createElement("div");
    mirror.className = "composer-caret-mirror";
    const caret = document.createElement("span");
    caret.className = "composer-animated-caret";
    caret.hidden = true;
    caret.setAttribute("aria-hidden", "true");
    mirror.setAttribute("aria-hidden", "true");
    document.body.append(mirror, caret);
    let frame = 0, composing = false, visible = false;
    const hide = () => {
      input.removeAttribute("data-animated-caret");
      caret.hidden = true;
      visible = false;
    };
    const draw = () => {
      frame = 0;
      if (motion.matches || composing || document.activeElement !== input || input.selectionStart !== input.selectionEnd || input.disabled) {
        hide(); return;
      }
      const style = getComputedStyle(input), box = input.getBoundingClientRect();
      for (const key of ["font", "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing", "textIndent", "textTransform", "tabSize", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "wordBreak", "overflowWrap", "direction"] as const) mirror.style[key] = style[key];
      mirror.style.width = `${input.clientWidth}px`;
      const marker = document.createElement("span");
      marker.textContent = "\u200b";
      mirror.replaceChildren(document.createTextNode(input.value.slice(0, input.selectionStart)), marker,
        document.createTextNode(input.value.slice(input.selectionStart)));
      const mark = marker.getBoundingClientRect(), home = mirror.getBoundingClientRect();
      const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.6;
      const x = box.left + input.clientLeft + mark.left - home.left - input.scrollLeft;
      const y = box.top + input.clientTop + mark.top - home.top - input.scrollTop;
      if (!Number.isFinite(x + y) || box.width === 0 || x < box.left || x > box.right - 1 || y < box.top || y + lineHeight > box.bottom + 1) {
        hide(); return;
      }
      caret.style.transition = visible ? "" : "none";
      caret.style.height = `${Math.min(lineHeight, parseFloat(style.fontSize) * 1.25)}px`;
      // Typing keeps the moving caret lit instead of landing mid-blink.
      for (const animation of caret.getAnimations()) {
        if (animation instanceof CSSAnimation) animation.currentTime = 0;
      }
      caret.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      caret.hidden = false;
      input.setAttribute("data-animated-caret", "true");
      visible = true;
    };
    const queue = () => { if (!frame) frame = requestAnimationFrame(draw); };
    refresh.current = queue;
    const start = () => { composing = true; hide(); };
    const end = () => { composing = false; queue(); };
    const resize = new ResizeObserver(queue);
    resize.observe(input);
    for (const name of ["input", "keyup", "click", "select", "focus", "blur"]) input.addEventListener(name, queue);
    input.addEventListener("compositionstart", start);
    input.addEventListener("compositionend", end);
    document.addEventListener("selectionchange", queue);
    document.addEventListener("scroll", queue, true);
    document.fonts.addEventListener("loadingdone", queue);
    window.addEventListener("resize", queue);
    motion.addEventListener("change", queue);
    queue();
    return () => {
      refresh.current = null;
      cancelAnimationFrame(frame); resize.disconnect(); hide();
      for (const name of ["input", "keyup", "click", "select", "focus", "blur"]) input.removeEventListener(name, queue);
      input.removeEventListener("compositionstart", start);
      input.removeEventListener("compositionend", end);
      document.removeEventListener("selectionchange", queue);
      document.removeEventListener("scroll", queue, true);
      document.fonts.removeEventListener("loadingdone", queue);
      window.removeEventListener("resize", queue);
      motion.removeEventListener("change", queue);
      mirror.remove(); caret.remove();
    };
  }, [enabled, ref]);
}
