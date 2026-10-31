// Artifacts across every session, for the Artifacts page.
//
// The chat's artifact store (lib/artifact-store.ts) only knows the loaded
// window of the open conversation. This index reads session files instead, so
// the page can show artifacts from history pages that were never loaded, from
// branches that are not checked out, and from chats (which have no side panel).
//
// It is derived, never authoritative: each file is re-parsed when its size or
// mtime changes, and nothing is written to disk. A cold pass is cheap: a file
// whose bytes never mention `:::artifact` is not parsed, and in one that does,
// only the lines that mention it go through JSON.parse.

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { artifactHasActiveContent, splitArtifacts, type ArtifactType } from "./artifacts.ts";
import type { SessionInfo, SessionWorkspaceKind } from "./types";

const MARKER = ":::artifact";
const MARKER_BYTES = Buffer.from(MARKER);
/** Larger files are streamed by line instead of read whole. */
const WHOLE_READ_MAX_BYTES = 16 * 1024 * 1024;
const READ_CONCURRENCY = 8;
const MAX_RESULTS = 500;
const SNIPPET_CONTEXT = 80;
// The SDK writes `type`, `id`, `parentId` first; enough for the branch walk.
const ENTRY_PREFIX_RE = /^\{"type":"([^"\\]+)","id":"([^"\\]+)","parentId":(?:null|"([^"\\]*)")/;

export interface IndexedArtifactVersion {
  entryId: string;
  timestamp: string;
  title: string;
  type: ArtifactType;
  lang: string;
  content: string;
  complete: boolean;
  /** On the branch the session file currently ends on (what the chat shows). */
  onActiveBranch: boolean;
  hash: string;
}

export interface IndexedArtifact {
  identifier: string;
  /** Every occurrence in file order, across all branches. */
  versions: IndexedArtifactVersion[];
}

interface Fingerprint {
  size: number;
  mtimeMs: number;
}

interface FileIndex {
  fp: Fingerprint;
  artifacts: IndexedArtifact[];
}

declare global {
  var __piWebArtifactIndex: Map<string, FileIndex> | undefined;
}

function cache(): Map<string, FileIndex> {
  if (!globalThis.__piWebArtifactIndex) globalThis.__piWebArtifactIndex = new Map();
  return globalThis.__piWebArtifactIndex;
}

function hashVersion(identifier: string, content: string): string {
  return createHash("sha1").update(identifier).update("\0").update(content).digest("hex");
}

type FoundVersion = { identifier: string; version: Omit<IndexedArtifactVersion, "onActiveBranch"> };

/** Feeds a session file line by line; `finish()` returns its artifacts. */
function createArtifactParser() {
  const parents = new Map<string, string | null>();
  let leafId: string | null = null;
  const found: FoundVersion[] = [];

  const line = (text: string) => {
    if (!text.trim()) return;
    if (!text.includes(MARKER)) {
      const prefix = ENTRY_PREFIX_RE.exec(text);
      if (prefix) {
        if (prefix[1] === "session") return;
        // The SDK's leaf after a load is the last entry in the file.
        parents.set(prefix[2], prefix[3] ?? null);
        leafId = prefix[2];
        return;
      }
    }
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return;
    }
    if (!entry || typeof entry !== "object" || entry.type === "session" || typeof entry.id !== "string") return;
    parents.set(entry.id, typeof entry.parentId === "string" ? entry.parentId : null);
    leafId = entry.id;
    if (entry.type !== "message" || !text.includes(MARKER)) return;
    const message = entry.message as { role?: unknown; content?: unknown } | undefined;
    if (message?.role !== "assistant") return;
    const texts = typeof message.content === "string"
      ? [message.content]
      : Array.isArray(message.content)
        ? message.content.flatMap((block) => (
          block && typeof block === "object" && block.type === "text" && typeof block.text === "string" ? [block.text as string] : []
        ))
        : [];
    const timestamp = typeof entry.timestamp === "string" ? entry.timestamp : "";
    for (const body of texts) {
      if (!body.includes(MARKER)) continue;
      for (const segment of splitArtifacts(body)) {
        if (segment.kind !== "artifact") continue;
        const { identifier, title, type, lang, content, complete } = segment.block;
        found.push({
          identifier,
          version: { entryId: entry.id, timestamp, title, type, lang, content, complete, hash: hashVersion(identifier, content) },
        });
      }
    }
  };

  const finish = (): IndexedArtifact[] => {
    const active = new Set<string>();
    for (let id = leafId; id && !active.has(id); id = parents.get(id) ?? null) active.add(id);
    const byIdentifier = new Map<string, IndexedArtifact>();
    for (const { identifier, version } of found) {
      let artifact = byIdentifier.get(identifier);
      if (!artifact) {
        artifact = { identifier, versions: [] };
        byIdentifier.set(identifier, artifact);
      }
      artifact.versions.push({ ...version, onActiveBranch: active.has(version.entryId) });
    }
    return [...byIdentifier.values()];
  };

  return { line, finish };
}

/** Parses one session file's text. Exported for tests. */
export function parseSessionArtifacts(text: string): IndexedArtifact[] {
  const parser = createArtifactParser();
  for (const line of text.split("\n")) parser.line(line);
  return parser.finish();
}

async function parseLargeFile(path: string): Promise<IndexedArtifact[]> {
  const parser = createArtifactParser();
  const stream = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) parser.line(line);
  } finally {
    lines.close();
    stream.destroy();
  }
  return parser.finish();
}

async function indexFile(path: string): Promise<FileIndex | null> {
  let fp: Fingerprint;
  try {
    const stats = await stat(path);
    fp = { size: stats.size, mtimeMs: stats.mtimeMs };
  } catch {
    return null;
  }
  const cached = cache().get(path);
  if (cached && cached.fp.size === fp.size && cached.fp.mtimeMs === fp.mtimeMs) return cached;
  let artifacts: IndexedArtifact[];
  try {
    if (fp.size > WHOLE_READ_MAX_BYTES) {
      artifacts = await parseLargeFile(path);
    } else {
      const bytes = await readFile(path);
      artifacts = bytes.includes(MARKER_BYTES) ? parseSessionArtifacts(bytes.toString("utf8")) : [];
    }
  } catch {
    return null;
  }
  const next = { fp, artifacts };
  cache().set(path, next);
  return next;
}

/** Indexes the catalogue's files, reusing every file whose fingerprint held. */
async function indexSessions(sessions: readonly SessionInfo[], signal?: AbortSignal): Promise<Map<string, FileIndex>> {
  const files = new Map<string, FileIndex>();
  const queue = sessions.filter((session) => session.path && !session.transient);
  let next = 0;
  const worker = async () => {
    while (next < queue.length && !signal?.aborted) {
      const session = queue[next++];
      const result = await indexFile(session.path);
      if (result) files.set(session.id, result);
    }
  };
  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, queue.length) }, worker));
  // Forget deleted files so the cache does not grow with every session ever opened.
  const live = new Set(queue.map((session) => session.path));
  for (const path of cache().keys()) if (!live.has(path)) cache().delete(path);
  return files;
}

export interface ArtifactSnippet {
  before: string;
  match: string;
  after: string;
}

export interface ArtifactSummary {
  sessionId: string;
  sessionTitle: string;
  cwd: string;
  projectRoot?: string;
  projectKey?: string;
  workspaceKind?: SessionWorkspaceKind;
  /** Output of a scheduled task's run. */
  scheduled: boolean;
  identifier: string;
  title: string;
  type: ArtifactType;
  versionCount: number;
  updated: string;
  /** Scripts or handlers: the page shows source until the user asks to run it. */
  activeContent: boolean;
  /** Content matched the query (title matches carry no snippet). */
  snippet?: ArtifactSnippet;
}

export interface ArtifactListResponse {
  artifacts: ArtifactSummary[];
  /** More matched than were returned. */
  truncated: boolean;
}

function sessionTitle(session: SessionInfo): string {
  return session.name || session.firstMessage || session.id;
}

/**
 * A fork starts as a copy of its source. Its artifacts are listed only when
 * they hold a version the source does not, so one page is not shown twice.
 */
function inheritedKeys(session: SessionInfo, files: Map<string, FileIndex>): Set<string> | null {
  if (session.relation?.kind !== "fork" || !session.parentSessionId) return null;
  const source = files.get(session.parentSessionId);
  if (!source) return null;
  return new Set(source.artifacts.flatMap((artifact) => artifact.versions.map((version) => version.hash)));
}

function snippetOf(text: string, start: number, length: number): ArtifactSnippet {
  const end = start + length;
  return {
    before: (start > SNIPPET_CONTEXT ? "…" : "") + text.slice(Math.max(0, start - SNIPPET_CONTEXT), start).replace(/\s+/g, " ").trimStart(),
    match: text.slice(start, end).replace(/\s+/g, " "),
    after: text.slice(end, end + SNIPPET_CONTEXT).replace(/\s+/g, " ").trimEnd() + (end + SNIPPET_CONTEXT < text.length ? "…" : ""),
  };
}

/**
 * Literal, case-insensitive match against the identifier, any version's title,
 * then the content (newest version first). Null when nothing matched.
 */
function matchArtifact(artifact: IndexedArtifact, needle: string): { snippet?: ArtifactSnippet } | null {
  if (!needle) return {};
  if (artifact.identifier.toLowerCase().includes(needle)) return {};
  if (artifact.versions.some((version) => version.title.toLowerCase().includes(needle))) return {};
  for (let index = artifact.versions.length - 1; index >= 0; index--) {
    const content = artifact.versions[index].content;
    const at = content.toLowerCase().indexOf(needle);
    if (at >= 0) return { snippet: snippetOf(content, at, needle.length) };
  }
  return null;
}

/**
 * Summarises the newest artifacts matching `query` (all of them when empty).
 * Type and project filters run in the page over this list. Subagent sessions
 * are left out: their prompts are exact and never ask for artifacts.
 */
export async function listArtifacts(
  sessions: readonly SessionInfo[],
  query = "",
  signal?: AbortSignal,
): Promise<ArtifactListResponse> {
  const candidates = sessions.filter((session) => session.relation?.kind !== "subagent");
  const files = await indexSessions(candidates, signal);
  const needle = query.trim().toLowerCase();
  const all: ArtifactSummary[] = [];
  for (const session of candidates) {
    const file = files.get(session.id);
    if (!file?.artifacts.length) continue;
    const inherited = inheritedKeys(session, files);
    for (const artifact of file.artifacts) {
      if (inherited && artifact.versions.every((version) => inherited.has(version.hash))) continue;
      const latest = artifact.versions.at(-1)!;
      const matched = matchArtifact(artifact, needle);
      if (!matched) continue;
      all.push({
        sessionId: session.id,
        sessionTitle: sessionTitle(session),
        cwd: session.cwd,
        projectRoot: session.projectRoot,
        projectKey: session.projectKey,
        workspaceKind: session.workspaceKind,
        scheduled: session.relation?.kind === "scheduled",
        identifier: artifact.identifier,
        title: latest.title,
        type: latest.type,
        versionCount: artifact.versions.length,
        updated: latest.timestamp || session.modified,
        activeContent: artifactHasActiveContent(latest),
        ...matched,
      });
    }
  }
  all.sort((a, b) => b.updated.localeCompare(a.updated) || a.title.localeCompare(b.title));
  return { artifacts: all.slice(0, MAX_RESULTS), truncated: all.length > MAX_RESULTS };
}

/** One artifact with every version's content, or null when it is gone. */
export async function getArtifact(session: SessionInfo, identifier: string): Promise<IndexedArtifact | null> {
  if (!session.path || session.transient) return null;
  const file = await indexFile(session.path);
  return file?.artifacts.find((artifact) => artifact.identifier === identifier) ?? null;
}

/** Test hook. */
export function resetArtifactIndexForTests(): void {
  globalThis.__piWebArtifactIndex = undefined;
}
