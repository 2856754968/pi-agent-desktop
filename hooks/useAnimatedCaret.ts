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
    const before = document.createTextNode("");
    const marker = document.createElement("span");
    marker.textContent = "\u200b";
    const after = document.createTextNode("");
    mirror.append(before, marker, after);
    document.body.append(mirror, caret);
    let frame = 0, composing = false, visible = false;
    let mirroredValue = "", mirroredSelection = -1;
    let measured = false, markerX = 0, markerY = 0;
    const mirroredStyles = new Map<string, string>();
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
      // Read the input before changing the mirror. Keep primitives: computed
      // styles are live and reading them again after a write can force layout.
      const style = getComputedStyle(input), box = input.getBoundingClientRect();
      const width = `${input.clientWidth}px`;
      const clientLeft = input.clientLeft, clientTop = input.clientTop;
      const scrollLeft = input.scrollLeft, scrollTop = input.scrollTop;
      const fontSize = parseFloat(style.fontSize);
      const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.6;
      const properties = ["font", "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing", "textIndent", "textTransform", "tabSize", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "wordBreak", "overflowWrap", "direction"] as const;
      const styles = properties.map(key => [key, style[key]] as const);
      let changed = false;
      for (const [key, value] of styles) {
        if (mirroredStyles.get(key) !== value) {
          mirror.style[key] = value;
          mirroredStyles.set(key, value);
          changed = true;
        }
      }
      if (mirror.style.width !== width) { mirror.style.width = width; changed = true; }
      if (mirroredValue !== input.value || mirroredSelection !== input.selectionStart) {
        mirroredValue = input.value;
        mirroredSelection = input.selectionStart;
        before.data = mirroredValue.slice(0, mirroredSelection);
        after.data = mirroredValue.slice(mirroredSelection);
        changed = true;
      }
      if (changed) {
        measured = false;
        // Let the browser lay out the hidden mirror before reading it. Recheck
        // input state next frame so a newer keystroke cannot paint an old seat.
        frame = requestAnimationFrame(draw);
        return;
      }
      if (!measured) {
        const mark = marker.getBoundingClientRect(), home = mirror.getBoundingClientRect();
        markerX = mark.left - home.left;
        markerY = mark.top - home.top;
        measured = true;
      }
      const x = box.left + clientLeft + markerX - scrollLeft;
      const y = box.top + clientTop + markerY - scrollTop;
      if (!Number.isFinite(x + y) || box.width === 0 || x < box.left || x > box.right - 1 || y < box.top || y + lineHeight > box.bottom + 1) {
        hide(); return;
      }
      // Read animation state before writing the visible caret's styles.
      const animations = caret.getAnimations();
      caret.style.transition = visible ? "" : "none";
      caret.style.height = `${Math.min(lineHeight, fontSize * 1.25)}px`;
      // Typing keeps the moving caret lit instead of landing mid-blink.
      for (const animation of animations) {
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
    const fontsLoaded = () => { measured = false; queue(); };
    const resize = new ResizeObserver(queue);
    resize.observe(input);
    for (const name of ["input", "keyup", "click", "select", "focus", "blur"]) input.addEventListener(name, queue);
    input.addEventListener("compositionstart", start);
    input.addEventListener("compositionend", end);
    document.addEventListener("selectionchange", queue);
    document.addEventListener("scroll", queue, true);
    document.fonts.addEventListener("loadingdone", fontsLoaded);
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
      document.fonts.removeEventListener("loadingdone", fontsLoaded);
      window.removeEventListener("resize", queue);
      motion.removeEventListener("change", queue);
      mirror.remove(); caret.remove();
    };
  }, [enabled, ref]);
}
