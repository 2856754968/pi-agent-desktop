import type { HomeTokenUsage } from "./home-official-pricing.ts";

/** Content-free projections of persisted history. Dates and ranges use UTC. */
export interface HomeUsageRecord {
  key: string;
  usageKey?: string;
  timestamp: string;
  message: boolean;
  model?: string;
  tokens?: number;
  usage?: HomeTokenUsage;
  costUsd?: number;
}
export interface HomeUsage {
  sessions: number;
  messages: number;
  tokens: number | null;
  costUsd: number | null;
  unpricedRecords: number;
  unpricedTokens: number;
  activeDays: number;
  peakHour: number | null;
  favoriteModel: string | null;
  days: { date: string; messages: number; tokens: number; models?: Record<string, number> }[];
  models: { name: string; tokens: number; costUsd: number | null; unpricedRecords: number }[];
  usageRecords: number;
  skippedFiles: number;
  generatedAt: string;
  breakdown?: HomeTokenUsage;
  scannedFiles?: number;
  duplicates?: number;
  invalidLines?: number;
  providers?: { name: string; tokens: number; costUsd: number; usageRecords: number }[];
}
export type HomeUsageRange = "all" | "30" | "7";
export function homeUsageRange(value: string | null): HomeUsageRange | null {
  if (value === null || value === "all") return "all";
  return value === "30" || value === "7" ? value : null;
}
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
const nonnegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Same usage eligibility and bucket fallback as /relay-usage. Never return content. */
export function projectHomeUsage(value: unknown, fallbackKey: string): HomeUsageRecord | null {
  const entry = object(value);
  if (!entry) return null;
  const message = entry.type === "message" ? object(entry.message) : null;
  const assistant = message?.role === "assistant";
  const isMessage = assistant || message?.role === "user";
  const summary = entry.type === "compaction" || entry.type === "branch_summary";
  const eligible = assistant || (message?.role === "toolResult" && message.usage !== undefined) || summary;
  const usage = object(eligible ? (summary ? entry.usage : message?.usage) : undefined);
  if (!isMessage && !eligible) return null;
  let timestamp = typeof entry.timestamp === "string" ? entry.timestamp : "";
  if (!timestamp && typeof message?.timestamp === "number") {
    const date = new Date(message.timestamp);
    if (Number.isFinite(date.getTime())) timestamp = date.toISOString();
  }
  // Undated usage still belongs to all-time totals, but not to dated charts/ranges.
  if (!Number.isFinite(Date.parse(timestamp))) timestamp = "";
  const model = assistant && typeof message?.model === "string" ? message.model : undefined;
  const provider = assistant && typeof message?.provider === "string" ? message.provider : "";
  const fields = ["input", "output", "cacheRead", "cacheWrite"] as const;
  const valid = usage && fields.every((key) => usage[key] === undefined || nonnegative(usage[key]))
    && (fields.some((key) => nonnegative(usage[key])) || nonnegative(usage.totalTokens));
  const buckets = valid ? Object.fromEntries(fields.map((key) => [key, usage[key] ?? 0])) as HomeTokenUsage : undefined;
  const sum = buckets ? Object.values(buckets).reduce((a, b) => a + b, 0) : undefined;
  const tokens = sum === 0 && nonnegative(usage?.totalTokens) ? usage.totalTokens : sum;
  const cost = object(usage?.cost);
  return {
    key: typeof entry.id === "string" ? JSON.stringify([entry.id, timestamp, entry.type, message?.role, provider, model]) : fallbackKey,
    timestamp, message: isMessage,
    model: model && provider ? provider + "/" + model : undefined,
    tokens, usage: buckets,
    // /relay-usage treats an absent recorded cost as zero; never reprice history.
    costUsd: tokens === undefined ? undefined : nonnegative(cost?.total) ? cost.total : 0,
  };
}

export function summarizeHomeUsage(records: Iterable<HomeUsageRecord>, sessionDates: string[], range: HomeUsageRange, now = new Date()): HomeUsage {
  const today = new Date(now); today.setUTCHours(0, 0, 0, 0);
  const cutoff = range === "all" ? -Infinity : today.getTime() - (Number(range) - 1) * 86400000;
  const inRange = (timestamp: string) => {
    const n = Date.parse(timestamp);
    return range === "all" || (Number.isFinite(n) && n >= cutoff && n <= now.getTime());
  };
  const days = new Map<string, { date: string; messages: number; tokens: number; models: Record<string, number> }>();
  const models = new Map<string, { name: string; tokens: number; costUsd: number; unpricedRecords: number }>();
  const providers = new Map<string, { name: string; tokens: number; costUsd: number; usageRecords: number }>();
  const seenMessages = new Set<string>(), seenUsage = new Set<string>();
  const hours = Array<number>(24).fill(0);
  const breakdown: HomeTokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let messages = 0, tokens = 0, usageRecords = 0, costUsd = 0, duplicates = 0;
  for (const record of records) {
    if (!inRange(record.timestamp)) continue;
    const dated = Number.isFinite(Date.parse(record.timestamp));
    const date = dated ? new Date(record.timestamp) : null;
    const key = date?.toISOString().slice(0, 10);
    const day = key ? days.get(key) ?? { date: key, messages: 0, tokens: 0, models: Object.create(null) as Record<string, number> } : null;
    if (record.message && !seenMessages.has(record.key)) {
      seenMessages.add(record.key); messages++;
      if (day && date) { day.messages++; hours[date.getUTCHours()]++; }
    }
    if (record.tokens !== undefined) {
      const identity = record.usageKey ?? record.key;
      if (seenUsage.has(identity)) duplicates++;
      else {
        seenUsage.add(identity); usageRecords++; tokens += record.tokens; costUsd += record.costUsd ?? 0;
        if (record.usage) for (const field of ["input", "output", "cacheRead", "cacheWrite"] as const) breakdown[field] += record.usage[field];
        const provider = record.model?.split("/")[0] ?? "";
        const subtotal = providers.get(provider) ?? { name: provider, tokens: 0, costUsd: 0, usageRecords: 0 };
        subtotal.tokens += record.tokens; subtotal.costUsd += record.costUsd ?? 0; subtotal.usageRecords++;
        providers.set(provider, subtotal);
        if (day) day.tokens += record.tokens;
        if (record.model) {
          const row = models.get(record.model) ?? { name: record.model, tokens: 0, costUsd: 0, unpricedRecords: 0 };
          row.tokens += record.tokens; row.costUsd += record.costUsd ?? 0; models.set(record.model, row);
          if (day) day.models[record.model] = (day.models[record.model] ?? 0) + record.tokens;
        }
      }
    }
    if (day && key) days.set(key, day);
  }
  const rankedModels = [...models.values()].sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name));
  return {
    sessions: sessionDates.filter(inRange).length, messages, tokens: usageRecords > 0 || messages === 0 ? tokens : null,
    costUsd: usageRecords > 0 || messages === 0 ? costUsd : null, unpricedRecords: 0, unpricedTokens: 0,
    activeDays: [...days.values()].filter((day) => day.messages > 0 || day.tokens > 0).length,
    peakHour: messages > 0 ? hours.indexOf(Math.max(...hours)) : null, favoriteModel: rankedModels[0]?.name ?? null,
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)), models: rankedModels,
    usageRecords, skippedFiles: 0, generatedAt: now.toISOString(), breakdown, duplicates,
    providers: [...providers.values()].sort((a, b) => b.tokens - a.tokens),
  };
}
