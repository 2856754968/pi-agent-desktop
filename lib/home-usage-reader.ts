import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { projectHomeUsage, summarizeHomeUsage, type HomeUsageRange, type HomeUsageRecord } from "./home-usage.ts";

// Matches relay-usage: JSON order and rewritten parentId do not change identity.
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${stableJson(obj[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Paths/roots are supplied by the server, never by request input. Read without migration. */
export async function readHomeUsage(sessions: { path: string; created: string }[], range: HomeUsageRange, now = new Date(), sessionDirs: string[] = []) {
  const records: HomeUsageRecord[] = [], dates: string[] = [];
  let skippedFiles = 0, invalidLines = 0, scannedFiles = 0;
  const paths = new Set<string>();
  const pathKey = (path: string) => process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
  const scanFile = async (path: string) => {
    if (paths.has(pathKey(path))) return;
    paths.add(pathKey(path));
    const stream = createReadStream(path, { encoding: "utf8" });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    const occurrences = new Map<string, number>();
    let header = false, lineNumber = 0;
    try {
      for await (const line of lines) {
        lineNumber++;
        const text = line.replace(/^\uFEFF/, "").trim();
        if (!text) continue;
        let entry;
        try { entry = JSON.parse(text); } catch { invalidLines++; continue; }
        if (!header) {
          if (entry?.type !== "session") { invalidLines++; break; }
          header = true; scannedFiles++; dates.push(typeof entry.timestamp === "string" ? entry.timestamp : ""); continue;
        }
        const record = projectHomeUsage(entry, path + ":" + lineNumber);
        if (!record) continue;
        const summary = entry.type === "compaction" || entry.type === "branch_summary";
        const identity = summary
          ? { type: entry.type, id: entry.id, timestamp: entry.timestamp, summary: entry.summary, usage: entry.usage, fromHook: entry.fromHook, details: entry.details }
          : { type: entry.type, id: entry.id, timestamp: entry.timestamp, message: entry.message };
        const hash = createHash("sha256").update(stableJson(identity)).digest("hex");
        let ordinal = 0;
        if (typeof entry.id !== "string" || !entry.id) {
          ordinal = (occurrences.get(hash) ?? 0) + 1; occurrences.set(hash, ordinal);
        }
        record.usageKey = `${hash}:${ordinal}`;
        records.push(record);
      }
    } catch { skippedFiles++; }
    finally { lines.close(); stream.destroy(); }
  };
  const scanDirectory = async (path: string) => {
    if (paths.has(pathKey(path))) return;
    paths.add(pathKey(path));
    let entries;
    try { entries = await readdir(path, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") skippedFiles++; return; }
    for (const entry of entries) {
      const child = resolve(path, entry.name);
      if (entry.isDirectory()) await scanDirectory(child);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) await scanFile(child);
    }
  };
  for (const dir of sessionDirs) await scanDirectory(dir);
  for (const session of sessions) await scanFile(session.path);
  return { ...summarizeHomeUsage(records, dates, range, now), skippedFiles, scannedFiles, invalidLines };
}
