"use client";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useHomeExperience } from "@/hooks/useHomeExperience";

export type CompanionState = "idle" | "thinking" | "working" | "attention" | "error";

/** Original geometric pixel crab; no Anthropic/Clawd or DSH artwork is bundled. */
export function ComposerCompanion({ state }: { state: CompanionState }) {
  const { t } = useI18n();
  const { mascot } = useHomeExperience();
  const previous = useRef(state);
  const [celebrating, setCelebrating] = useState(false);
  useEffect(() => {
    const finished = state === "idle" && (previous.current === "working" || previous.current === "thinking");
    previous.current = state;
    setCelebrating(finished);
    if (!finished) return;
    const timer = window.setTimeout(() => setCelebrating(false), 2400);
    return () => window.clearTimeout(timer);
  }, [state]);
  const displayState = celebrating && state === "idle" ? "done" : state;
  if (!mascot) return null;
  return <div className="composer-companion-seat">
    <div className="composer-companion" data-state={displayState} role="img" aria-label={t("home.companion." + displayState)}
      title={t("home.companion." + displayState)}>
      <svg viewBox="0 0 48 32" width="60" height="40" shapeRendering="crispEdges" aria-hidden="true">
        <g className="companion-claws" fill="currentColor">
          <path d="M2 7h4v5h4v4H2zM42 7h4v9h-8v-4h4z" />
        </g>
        <g className="companion-body" fill="currentColor">
          <path d="M12 8h24v4h4v12H8V12h4zM12 24h4v6H8v-3h4zM22 24h4v6h-4zM32 24h4v3h4v3h-8z" />
          <path d="M14 3h5v6h-5zM29 3h5v6h-5z" />
        </g>
        <g className="companion-eyes" fill="var(--surface)">
          <path d="M15 4h3v3h-3zM30 4h3v3h-3z" />
        </g>
        <path d="M20 16h8v2h-8z" fill="var(--surface)" />
      </svg>
    </div>
  </div>;
}
