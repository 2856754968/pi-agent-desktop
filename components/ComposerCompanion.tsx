"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useHomeExperience } from "@/hooks/useHomeExperience";
import { COMPANION_FRAME_MS, COMPANION_GUTTER, COMPANION_SHEETS, type CompanionAnimation } from "@/lib/companion-sheets";

export type CompanionState = "idle" | "thinking" | "working" | "attention" | "error" | "typing" | "compacting" | "conducting";
const IDLE_EXTRAS = ["idle-look", "idle-wave", "idle-laptop"] as const;
const nextExtraDelay = () => 20000 + Math.random() * 20000;

/** v0.19.8 crab artwork and reactions, driven by Pi lifecycle signals. */
export function ComposerCompanion({ state }: { state: CompanionState }) {
  const { t } = useI18n();
  const { mascot } = useHomeExperience();
  const previous = useRef(state);
  const strip = useRef<HTMLSpanElement>(null);
  const seat = useRef<HTMLDivElement>(null);
  const dragged = useRef(false);
  const drag = useRef<{ id: number; start: number; y: number; offset: number; moved: boolean } | null>(null);
  const clicks = useRef<number[]>([]);
  const quietSince = useRef(0);
  const [offset, setOffset] = useState(0);
  const [extra, setExtra] = useState<CompanionAnimation | null>(null);
  const extraRef = useRef(extra);
  extraRef.current = extra;
  const [reaction, setReaction] = useState(0);
  const [celebrating, setCelebrating] = useState(false);
  useEffect(() => {
    const finished = state === "idle" && ["working", "thinking", "typing", "compacting", "conducting"].includes(previous.current);
    previous.current = state;
    quietSince.current = Date.now();
    setCelebrating(finished);
    // The reader's hand keeps priority over lifecycle changes until released.
    setExtra((value) => value !== null && ["drag", "poke-left", "poke-right", "tickle"].includes(value) ? value : null);
    if (!finished) return;
    const timer = window.setTimeout(() => setCelebrating(false), 2560);
    return () => window.clearTimeout(timer);
  }, [state]);
  useEffect(() => {
    if (!mascot || state !== "idle" || celebrating) return;
    quietSince.current = Date.now();
    let nextExtra = Date.now() + nextExtraDelay();
    let timer: number;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(check, Math.max(1, Math.min(quietSince.current + 60000, nextExtra) - Date.now()));
    };
    const check = () => {
      const now = Date.now();
      if (drag.current) quietSince.current = now;
      if (!document.hidden && !drag.current) {
        if (now - quietSince.current >= 60000) {
          setExtra("sleeping");
          return;
        }
        if (now >= nextExtra) {
          if (!motion.matches && extraRef.current === null) setExtra(IDLE_EXTRAS[Math.floor(Math.random() * IDLE_EXTRAS.length)]);
          nextExtra = now + nextExtraDelay();
        }
      } else nextExtra = now + nextExtraDelay();
      // Hidden pages wait for visibility rather than spinning on an expired deadline.
      if (!document.hidden) schedule();
    };
    const activity = () => {
      quietSince.current = Date.now();
      if (extraRef.current === "sleeping") setExtra(motion.matches ? null : "waking");
      schedule();
    };
    schedule();
    document.addEventListener("pointermove", activity, { passive: true });
    document.addEventListener("pointerdown", activity, { passive: true });
    document.addEventListener("keydown", activity);
    document.addEventListener("visibilitychange", activity);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointermove", activity);
      document.removeEventListener("pointerdown", activity);
      document.removeEventListener("keydown", activity);
      document.removeEventListener("visibilitychange", activity);
    };
  }, [mascot, state, celebrating]);
  useEffect(() => {
    if (mascot) return;
    drag.current = null;
    clicks.current = [];
    setExtra(null);
  }, [mascot]);
  useEffect(() => {
    if (!extra || extra === "sleeping" || extra === "drag") return;
    const timer = window.setTimeout(() => setExtra(null), COMPANION_SHEETS[extra][0] * COMPANION_FRAME_MS);
    return () => window.clearTimeout(timer);
  }, [extra, reaction]);
  const displayState = celebrating && state === "idle" ? "done" : state;
  const animation: CompanionAnimation = extra ?? (celebrating && state === "idle" ? "happy"
    : state === "working" ? "building" : state === "attention" ? "notification" : state);
  const [frames, x, y, width, height, still] = COMPANION_SHEETS[animation];
  const cellWidth = width + COMPANION_GUTTER * 2;
  const cellHeight = height + COMPANION_GUTTER * 2;
  useEffect(() => {
    if (!mascot || !strip.current) return;
    const element = strip.current;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const transform = (frame: number) => `translate(${-(frame % 8 * cellWidth + COMPANION_GUTTER) * 2}px, ${-(Math.floor(frame / 8) * cellHeight + COMPANION_GUTTER) * 2}px)`;
    const once = extra !== null && extra !== "sleeping" && extra !== "drag";
    const keyframes = Array.from({ length: frames }, (_, frame) => ({ offset: frame / frames, transform: transform(frame), easing: "steps(1)" }));
    keyframes.push({ offset: 1, transform: transform(once ? frames - 1 : 0), easing: "steps(1)" });
    const playing = element.animate(keyframes, { duration: frames * COMPANION_FRAME_MS, iterations: once ? 1 : Infinity, fill: "forwards" });
    const sync = () => {
      if (motion.matches) { playing.cancel(); element.style.transform = transform(still); }
      else {
        element.style.transform = "";
        if (document.hidden) playing.pause();
        else if (playing.playState !== "finished") playing.play();
      }
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    motion.addEventListener("change", sync);
    return () => { playing.cancel(); document.removeEventListener("visibilitychange", sync); motion.removeEventListener("change", sync); };
  }, [animation, extra, reaction, mascot, frames, cellWidth, cellHeight, still]);
  useEffect(() => {
    if (!mascot || !seat.current) return;
    const observer = new ResizeObserver(() => {
      const min = Math.min(0, -(seat.current?.clientWidth ?? 320) + 104);
      setOffset((value) => Math.max(min, Math.min(0, value)));
    });
    observer.observe(seat.current);
    return () => observer.disconnect();
  }, [mascot]);
  if (!mascot) return null;
  const labelKey = ["typing", "compacting", "conducting"].includes(displayState) ? "working" : displayState;
  const react = (key: CompanionAnimation) => { setExtra(key); setReaction((value) => value + 1); };
  const release = (id: number, cancelled: boolean) => {
    if (drag.current?.id !== id) return;
    dragged.current = drag.current.moved;
    drag.current = null;
    if (dragged.current || cancelled) { quietSince.current = Date.now(); setExtra(null); }
  };
  return <div ref={seat} className="composer-companion-seat">
    <button type="button" className="composer-companion" data-state={displayState} data-animation={animation}
      aria-label={t("home.companion." + labelKey)} title={t("home.companion." + labelKey)}
      style={{ "--companion-offset": `${offset}px` } as CSSProperties}
      onPointerDown={(event) => {
        if (event.button !== 0 || drag.current) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        dragged.current = false;
        drag.current = { id: event.pointerId, start: event.clientX, y: event.clientY, offset, moved: false };
      }}
      onPointerMove={(event) => {
        if (drag.current?.id !== event.pointerId) return;
        const delta = event.clientX - drag.current.start;
        if (!drag.current.moved && Math.hypot(delta, event.clientY - drag.current.y) >= 4) {
          drag.current.moved = true; clicks.current = []; react("drag");
        }
        if (!drag.current.moved) return;
        const seatWidth = seat.current?.clientWidth ?? 320;
        setOffset(Math.max(Math.min(0, -seatWidth + 104), Math.min(0, drag.current.offset + delta)));
      }}
      onPointerUp={(event) => release(event.pointerId, false)}
      onPointerCancel={(event) => release(event.pointerId, true)}
      onLostPointerCapture={(event) => { if (drag.current) release(event.pointerId, true); }}
      onClick={(event) => {
        event.stopPropagation();
        if (dragged.current) { dragged.current = false; return; }
        const now = Date.now();
        if (now - (clicks.current.at(-1) ?? 0) > 450) clicks.current = [];
        clicks.current.push(now);
        const box = event.currentTarget.getBoundingClientRect();
        if (clicks.current.length >= 4) { clicks.current = []; react("tickle"); }
        else react(event.detail === 0 || event.clientX - box.left < box.width / 2 ? "poke-left" : "poke-right");
      }} />
    <span className="companion-art" style={{ "--companion-offset": `${offset}px` } as CSSProperties} aria-hidden="true">
    <span className="companion-sprite-window" style={{ left: x * 2, top: y * 2, width: width * 2, height: height * 2 } as CSSProperties}>
      <span ref={strip} className="companion-sprite" style={{
        width: cellWidth * 16, height: Math.ceil(frames / 8) * cellHeight * 2,
        backgroundImage: `url(/claude-companion/${animation}.png)`,
        "--sprite-ink": `url(/claude-companion/${animation}-ink.png)`,
      } as CSSProperties} />
    </span>
    </span>
  </div>;
}
