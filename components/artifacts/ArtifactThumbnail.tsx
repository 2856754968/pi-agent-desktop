"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useTheme } from "@/hooks/useTheme";
import { useHtmlPreviewOptions } from "@/hooks/useHtmlPreviewFrame";
import type { ArtifactSummary } from "@/lib/artifact-index";
import { buildHtmlPreviewDocument } from "@/lib/html-preview";
import { ArtifactTypeIcon } from "../ArtifactCard";
import { renderMermaidSvg } from "../MermaidBlock";
import { THUMBNAIL_MAX_CHARS, svgImageSource, textExcerpt, thumbnailKind } from "./artifacts-helpers";

// Thumbnails show the newest version of each row as it scrolls into view.
// Nothing here runs the artifact's own code: images cannot, and the HTML frame
// is sandboxed with no permissions at all (no scripts, forms or popups).

const MAX_CONCURRENT_FETCHES = 4;
const MAX_CACHED = 200;
/** The frame renders at this size, then scales down to the thumbnail box. */
const FRAME_WIDTH = 800;
const FRAME_HEIGHT = 600;

const contentCache = new Map<string, Promise<string | null>>();
const mermaidCache = new Map<string, Promise<string | null>>();
let activeFetches = 0;
const waiting: Array<() => void> = [];
let mermaidQueue: Promise<unknown> = Promise.resolve();

function remember<T>(cache: Map<string, T>, key: string, value: T): T {
  cache.set(key, value);
  if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
  return value;
}

async function withFetchSlot<T>(run: () => Promise<T>): Promise<T> {
  if (activeFetches >= MAX_CONCURRENT_FETCHES) await new Promise<void>((resolve) => waiting.push(resolve));
  activeFetches++;
  try {
    return await run();
  } finally {
    activeFetches--;
    waiting.shift()?.();
  }
}

/** The newest version's content; keyed by revision so a new version refetches. */
function loadLatestContent(item: ArtifactSummary): Promise<string | null> {
  const key = `${item.sessionId}\u0000${item.identifier}\u0000${item.versionCount}\u0000${item.updated}`;
  const cached = contentCache.get(key);
  if (cached) return cached;
  const params = new URLSearchParams({ session: item.sessionId, identifier: item.identifier, latest: "1" });
  return remember(contentCache, key, withFetchSlot(async () => {
    const response = await fetch(`/api/artifacts/item?${params}`, { cache: "no-store" });
    if (!response.ok) return null;
    const data = await response.json() as { versions?: Array<{ content?: unknown }> };
    const content = data.versions?.at(-1)?.content;
    return typeof content === "string" && content.length <= THUMBNAIL_MAX_CHARS ? content : null;
  }).catch(() => {
    contentCache.delete(key);
    return null;
  }));
}

/** Mermaid keeps global configuration, so renders run one at a time. */
function renderMermaidThumbnail(code: string, isDark: boolean): Promise<string | null> {
  const key = `${isDark ? "dark" : "light"}\u0000${code}`;
  const cached = mermaidCache.get(key);
  if (cached) return cached;
  const next = mermaidQueue.then(() => renderMermaidSvg(code, isDark)).catch(() => null);
  mermaidQueue = next;
  return remember(mermaidCache, key, next);
}

/** True while the element is within a screen of the scroll container's viewport. */
function useNearViewport(ref: RefObject<HTMLElement | null>, root: RefObject<HTMLElement | null>): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setNear(entry.isIntersecting),
      { root: root.current, rootMargin: "100% 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, root]);
  return near;
}

interface Props {
  item: ArtifactSummary;
  /** The scrolling list, so rows just below the fold load ahead of time. */
  scrollRoot: RefObject<HTMLElement | null>;
}

export function ArtifactThumbnail({ item, scrollRoot }: Props) {
  const kind = thumbnailKind(item.type);
  const ref = useRef<HTMLSpanElement>(null);
  const near = useNearViewport(ref, scrollRoot);
  const { isDark } = useTheme();
  const options = useHtmlPreviewOptions();
  const [content, setContent] = useState<{ key: string; value: string | null } | null>(null);
  const [mermaidSvg, setMermaidSvg] = useState<{ key: string; value: string | null } | null>(null);
  const contentKey = `${item.sessionId}\u0000${item.identifier}\u0000${item.versionCount}\u0000${item.updated}`;

  useEffect(() => {
    if (kind === "icon" || !near) return;
    let cancelled = false;
    void loadLatestContent(item).then((value) => {
      if (!cancelled) setContent({ key: contentKey, value });
    });
    return () => { cancelled = true; };
    // `item` is read for its ids, which `contentKey` covers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, near, contentKey]);

  const source = content?.key === contentKey ? content.value : undefined;
  const mermaidKey = `${isDark}\u0000${contentKey}`;

  useEffect(() => {
    if (kind !== "mermaid" || !source) return;
    let cancelled = false;
    void renderMermaidThumbnail(source, isDark).then((value) => {
      if (!cancelled) setMermaidSvg({ key: mermaidKey, value });
    });
    return () => { cancelled = true; };
  }, [kind, source, isDark, mermaidKey]);

  const frameDoc = useMemo(() => (
    kind === "frame" && source ? buildHtmlPreviewDocument("html", source, options) : null
  ), [kind, source, options]);

  const svg = kind === "mermaid" ? (mermaidSvg?.key === mermaidKey ? mermaidSvg.value : undefined) : kind === "image" ? source : undefined;
  let body: ReactNode = <ArtifactTypeIcon type={item.type} size={18} />;
  let filled = false;
  if (svg) {
    // A data: URL; next/image has nothing to optimise.
    // eslint-disable-next-line @next/next/no-img-element
    body = <img className="artifacts-thumb-image" src={svgImageSource(svg)} alt="" draggable={false} />;
    filled = true;
  } else if (frameDoc && near) {
    // Unmounted again once the row is far away: a frame is a whole document.
    body = (
      <iframe
        className="artifacts-thumb-frame"
        srcDoc={frameDoc}
        sandbox=""
        tabIndex={-1}
        aria-hidden="true"
        title=""
        width={FRAME_WIDTH}
        height={FRAME_HEIGHT}
      />
    );
    filled = true;
  } else if (kind === "text" && source) {
    body = <span className={`artifacts-thumb-text${item.type === "code" ? " is-code" : ""}`}>{textExcerpt(source, item.type)}</span>;
    filled = true;
  }

  return (
    <span ref={ref} className={`artifacts-thumb${filled ? " is-filled" : ""}`} aria-hidden="true">
      {body}
    </span>
  );
}
