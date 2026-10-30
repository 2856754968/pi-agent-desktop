"use client";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useHomeExperience } from "@/hooks/useHomeExperience";
import type { HomeUsage, HomeUsageRange } from "@/lib/home-usage";
import { ConfigButton } from "./SettingsUi";

export function HomeUsageDashboard() {
  const { dashboard } = useHomeExperience();
  return dashboard ? <Dashboard /> : null;
}

function Dashboard() {
  const { t, locale } = useI18n();
  const [range, setRange] = useState<HomeUsageRange>("30");
  const [tab, setTab] = useState<"overview" | "models">("overview");
  const [result, setResult] = useState<{ range: HomeUsageRange; data: HomeUsage } | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    fetch("/api/home-usage?range=" + range, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Usage unavailable");
        const data: HomeUsage = await response.json();
        if (!controller.signal.aborted) setResult({ range, data });
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [range, revision]);
  const data = !loading && result?.range === range ? result.data : null;
  const format = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString(locale);
  const calendar = useMemo(() => {
    if (!data) return [];
    const end = new Date(data.generatedAt);
    end.setUTCHours(0, 0, 0, 0);
    const byDay = new Map(data.days.map((day) => [day.date, day]));
    const length = range === "7" ? 7 : range === "30" ? 30 : 91;
    const max = Math.max(1, ...data.days.map((day) => day.messages));
    return Array.from({ length }, (_, index) => {
      const date = new Date(end.getTime() - (length - index - 1) * 86400000).toISOString().slice(0, 10);
      const day = byDay.get(date);
      const messages = day?.messages ?? 0;
      return { date, messages, level: messages === 0 ? 0 : Math.max(1, Math.ceil(messages / max * 4)) };
    });
  }, [data, range]);
  const metrics = [
    ["sessions", data?.sessions], ["messages", data?.messages], ["tokens", data?.tokens],
    ["activeDays", data?.activeDays], ["peakHour", data?.peakHour == null ? "—" : String(data.peakHour).padStart(2, "0") + ":00 UTC"],
    ["favoriteModel", data?.favoriteModel ?? "—"],
  ] as const;
  return <section className="home-usage" aria-label={t("home.dashboard")} aria-busy={loading}>
    <div className="home-usage-header">
      <div className="home-usage-tabs" role="group" aria-label={t("home.dashboard")}>
        {(["overview", "models"] as const).map((value) => <button type="button" key={value} aria-pressed={tab === value}
          onClick={() => setTab(value)}>{t("home." + value)}</button>)}
      </div>
      <div className="home-usage-tabs" role="group" aria-label={t("home.range")}>
        {(["all", "30", "7"] as const).map((value) => <button type="button" key={value} aria-pressed={range === value}
          onClick={() => setRange(value)}>{t("home.range." + value)}</button>)}
      </div>
    </div>
    {loading ? <p className="home-usage-note" role="status">{t("home.loading")}</p> : error ? <div role="alert" className="home-usage-note">
      <p>{t("home.error")}</p><ConfigButton variant="secondary" size="small" onClick={() => setRevision((n) => n + 1)}>{t("home.retry")}</ConfigButton>
    </div> : data && <>
      {tab === "overview" ? <>
        <dl className="home-usage-metrics">{metrics.map(([key, value]) => <div key={key}>
          <dt>{t("home." + key)}</dt><dd title={typeof value === "string" ? value : undefined}>{typeof value === "string" ? value : format(value)}</dd>
        </div>)}</dl>
        <p className="home-usage-note">{t(range === "all" ? "home.activity91" : "home.activity")}</p>
        <div className="home-usage-calendar" aria-label={t("home.activity")}>
          {calendar.map((day) => <span key={day.date} data-level={day.level} role="img"
            aria-label={day.date + ": " + t("home.messageCount", { count: day.messages })}
            title={day.date + ": " + t("home.messageCount", { count: day.messages })} />)}
        </div>
      </> : data.models.length > 0 ? <ol className="home-usage-models">
        {data.models.slice(0, 10).map((model) => <li key={model.name}>
          <div><span>{model.name}</span><span>{format(model.tokens)}</span></div>
          <meter min={0} max={Math.max(1, data.tokens ?? 0)} value={model.tokens} aria-label={model.name} />
        </li>)}
      </ol> : <p className="home-usage-note">{t("home.noUsage")}</p>}
      {data.messages === 0 && <p className="home-usage-note">{t("home.empty")}</p>}
      {data.skippedFiles > 0 && <p className="home-usage-note" role="status">{t("home.skipped", { count: data.skippedFiles })}</p>}
      <p className="home-usage-note">{t("home.dataHint")}</p>
    </>}
  </section>;
}
