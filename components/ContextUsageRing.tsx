import { useI18n } from "@/hooks/useI18n";
import { useChatEffect, type ChatEffectValue } from "@/hooks/useChatEffects";
import type { ContextUsage, SessionStatsInfo } from "@/lib/pi-types";

type ContextDisplay = ChatEffectValue<"contextDisplay">;
type ContextPalette = ChatEffectValue<"contextPalette">;

function fmtWindow(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

export function ContextUsageMeter({ percent, display, palette, showPercent }: {
  percent: number | null;
  display: ContextDisplay;
  palette: ContextPalette;
  showPercent: boolean;
}) {
  const pct = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  const resolvedPalette = palette === "auto" ? (display === "band" ? "cool" : "warm") : palette;
  const lowColor = resolvedPalette === "cool" ? "var(--context-usage-blue)" : "var(--context-usage-green)";
  const color = pct >= 90 ? "var(--danger)"
    : display === "ramp"
      ? pct <= 65 ? `color-mix(in oklab, ${lowColor}, var(--warning) ${pct * 100 / 65}%)`
        : `color-mix(in oklab, var(--warning), var(--danger) ${(pct - 65) * 4}%)`
      : pct >= 60 ? "var(--warning)" : lowColor;

  return (
    <span className="context-usage-meter" aria-hidden="true">
      {display === "pie" ? (
        <span className="context-usage-pie" style={{ background: `conic-gradient(${color} ${pct}%, var(--context-usage-track) 0)` }} />
      ) : (
        <svg className="context-usage-ring" viewBox="0 0 16 16" fill="none" strokeWidth="2">
          <circle cx="8" cy="8" r="6.5" stroke="var(--context-usage-track)" />
          {pct > 0 && <circle cx="8" cy="8" r="6.5" pathLength="100" stroke={color}
            strokeDasharray={pct < 100 ? `${pct} 100` : undefined} transform="rotate(-90 8 8)" />}
        </svg>
      )}
      {showPercent && <span className="context-usage-percent">{percent === null ? "—" : `${Math.round(pct)}%`}</span>}
    </span>
  );
}

export function ContextUsageRing({ contextUsage, sessionStats, onOpenStats }: {
  contextUsage?: ContextUsage | null;
  sessionStats?: SessionStatsInfo | null;
  onOpenStats?: () => void;
}) {
  const { t } = useI18n();
  const display = useChatEffect("contextDisplay");
  const palette = useChatEffect("contextPalette");
  const showPercent = useChatEffect("contextPercent") === "on";

  if (!contextUsage) return null;
  const percent = Number.isFinite(contextUsage.percent) ? contextUsage.percent : null;
  const windowSize = contextUsage.contextWindow ?? 0;
  const showTooltip = percent !== null || windowSize > 0;
  const tooltipParts: string[] = [];
  if (showTooltip) {
    tooltipParts.push(percent !== null ? `${percent.toFixed(1)}% ctx` : `— / ${fmtWindow(windowSize)}`);
    if (sessionStats && sessionStats.tokens.total > 0) {
      tooltipParts.push(`${fmtWindow(sessionStats.tokens.total)} tok`);
    } else if (percent !== null && windowSize > 0) {
      tooltipParts[0] += ` / ${fmtWindow(windowSize)}`;
    }
    if (sessionStats && sessionStats.cost > 0) {
      tooltipParts.push(`$${sessionStats.cost.toFixed(3)}`);
    }
  }
  const title = tooltipParts.length > 0 ? tooltipParts.join(" · ") : t("chat.ctxUsage");

  return (
    <button
      type="button"
      className="context-usage-button"
      aria-label={title}
      title={showTooltip ? title : undefined}
      aria-haspopup="dialog"
      onClick={onOpenStats}
    >
      <ContextUsageMeter percent={percent} display={display} palette={palette} showPercent={showPercent} />
    </button>
  );
}
