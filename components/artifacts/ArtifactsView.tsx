"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useI18n } from "@/hooks/useI18n";
import { isImeComposing } from "@/lib/ime";
import { formatRelativeTime } from "@/lib/i18n/format";
import { ARTIFACT_TYPES } from "@/lib/artifacts";
import type { ArtifactListResponse, ArtifactSummary, IndexedArtifactVersion } from "@/lib/artifact-index";
import { AppSelect } from "../AppSelect";
import { ARTIFACT_TYPE_LABEL } from "../ArtifactCard";
import { ARTIFACT_TOOLBAR_ICON, ArtifactView } from "../ArtifactView";
import { ArtifactThumbnail } from "./ArtifactThumbnail";
import { artifactKey, filterArtifacts, scopeOptions } from "./artifacts-helpers";

interface Props {
  /** How many sessions are running; the list reloads when one finishes. */
  runningCount: number;
  /** Opens the conversation scrolled to the entry. Resolves false when the session is gone. */
  onOpenInConversation: (sessionId: string, entryId: string) => Promise<boolean>;
  /** Forks the conversation at the entry and sends `prompt` there. Rejects with a message to show. */
  onContinueInNewChat: (sessionId: string, entryId: string, prompt: string) => Promise<void>;
}

type ItemVersion = Omit<IndexedArtifactVersion, "hash">;
type Detail =
  | { key: string; status: "loading" }
  | { key: string; status: "ready"; versions: ItemVersion[] }
  | { key: string; status: "missing" | "error"; error?: string };

const SEARCH_DEBOUNCE_MS = 250;

/**
 * The Artifacts page: every artifact from every conversation, searchable, with
 * a preview that does not depend on the conversation being open. Scripted
 * content shows its source until the user picks Preview, like other history.
 */
export function ArtifactsView({ runningCount, onOpenInConversation, onContinueInNewChat }: Props) {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [scope, setScope] = useState("");
  const [list, setList] = useState<ArtifactListResponse | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<ArtifactSummary | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /** The version a "continue in new chat" request is being written for. */
  const [continueIndex, setContinueIndex] = useState<number | null>(null);
  const [continueText, setContinueText] = useState("");
  const [continueBusy, setContinueBusy] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const listPaneRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const runningRef = useRef(runningCount);

  useEffect(() => { searchRef.current?.focus({ preventScroll: true }); }, []);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  // A finished run may have written artifacts; so may another window.
  useEffect(() => {
    if (runningCount < runningRef.current) setReload((n) => n + 1);
    runningRef.current = runningCount;
  }, [runningCount]);
  useEffect(() => {
    const onFocus = () => setReload((n) => n + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/artifacts?q=${encodeURIComponent(search)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as ArtifactListResponse & { error?: string };
        if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
        setList(data);
        setListError(null);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setListError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [search, reload]);

  const items = useMemo(() => list?.artifacts ?? [], [list]);
  const scopes = useMemo(() => scopeOptions(items, t("artifacts.page.chats")), [items, t]);
  // A scope that left the list (search narrowed it away) stops filtering.
  const effectiveScope = scopes.some((option) => option.value === scope) ? scope : "";
  const visible = useMemo(() => filterArtifacts(items, type, effectiveScope), [items, type, effectiveScope]);

  // Follow the selected artifact's newest summary, so a reload that brought a
  // new version also refreshes the preview.
  const selectedKey = selected ? artifactKey(selected) : null;
  const current = selectedKey ? items.find((item) => artifactKey(item) === selectedKey) ?? selected : null;
  const revision = current ? `${current.versionCount}:${current.updated}` : "";

  useEffect(() => {
    if (!current || !selectedKey) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    setDetail((previous) => (previous?.key === selectedKey && previous.status === "ready" ? previous : { key: selectedKey, status: "loading" }));
    const params = new URLSearchParams({ session: current.sessionId, identifier: current.identifier });
    fetch(`/api/artifacts/item?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as { versions?: ItemVersion[]; error?: string };
        if (response.status === 404) {
          setDetail({ key: selectedKey, status: "missing" });
          return;
        }
        if (!response.ok || !data.versions) throw new Error(data.error ?? `HTTP ${response.status}`);
        setDetail({ key: selectedKey, status: "ready", versions: data.versions });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setDetail({ key: selectedKey, status: "error", error: error instanceof Error ? error.message : String(error) });
      });
    return () => controller.abort();
    // `current` is read for its ids, which `selectedKey` covers; `revision` refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, revision]);

  const versions = detail?.key === selectedKey && detail.status === "ready" ? detail.versions : undefined;

  function selectItem(item: ArtifactSummary | null) {
    setActionError(null);
    setContinueIndex(null);
    setContinueText("");
    setSelected(item);
  }

  const continueVersion = continueIndex !== null ? versions?.[continueIndex] : undefined;

  async function submitContinue(event?: FormEvent) {
    event?.preventDefault();
    const request = continueText.trim();
    if (!current || !continueVersion || continueIndex === null || !request || continueBusy) return;
    setContinueBusy(true);
    setActionError(null);
    try {
      await onContinueInNewChat(current.sessionId, continueVersion.entryId, t("artifacts.page.continuePrompt", {
        title: continueVersion.title,
        identifier: current.identifier,
        version: continueIndex + 1,
        request,
      }));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setContinueBusy(false);
    }
  }

  async function openInConversation(version: ItemVersion) {
    if (!current) return;
    setActionError(null);
    if (!(await onOpenInConversation(current.sessionId, version.entryId))) setActionError(t("artifacts.page.sessionMissing"));
  }

  const typeOptions = [
    { value: "", label: t("artifacts.page.allTypes") },
    ...ARTIFACT_TYPES.map((value) => ({ value, label: ARTIFACT_TYPE_LABEL[value] })),
  ];
  const scopeSelectOptions = [{ value: "", label: t("artifacts.page.allProjects") }, ...scopes];

  const detailMessage = !detail || detail.key !== selectedKey || detail.status === "loading"
    ? t("artifacts.page.loadingItem")
    : detail.status === "missing"
      ? t("artifacts.page.itemUnavailable")
      : detail.status === "error"
        ? t("artifacts.page.loadFailed", { error: detail.error ?? "" })
        : "";

  return (
    <section
      ref={rootRef}
      className={`artifacts-view${current ? " has-selection" : ""}`}
      tabIndex={-1}
      aria-label={t("artifacts.page.title")}
      // Esc here must not reach the global shortcut that stops the agent running behind this page.
      onKeyDown={(event) => { if (event.key === "Escape") event.preventDefault(); }}
    >
      <div ref={listPaneRef} className="artifacts-list-pane">
        <header className="artifacts-header">
          <h2 className="scheduled-title">{t("artifacts.page.title")}</h2>
          <p className="scheduled-subtitle">{t("artifacts.page.subtitle")}</p>
        </header>
        <div className="artifacts-filters">
          <input
            ref={searchRef}
            type="search"
            className="scheduled-input artifacts-search"
            value={query}
            maxLength={200}
            placeholder={t("artifacts.page.searchPlaceholder")}
            aria-label={t("artifacts.page.searchLabel")}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="artifacts-filter-row">
            <AppSelect value={type} onValueChange={setType} options={typeOptions} aria-label={t("artifacts.page.typeLabel")} className="artifacts-filter" />
            <AppSelect value={effectiveScope} onValueChange={setScope} options={scopeSelectOptions} aria-label={t("artifacts.page.scopeLabel")} className="artifacts-filter" />
          </div>
        </div>
        {listError && <p className="scheduled-error" role="alert">{t("artifacts.page.loadFailed", { error: listError })}</p>}
        {!list && loading && <p className="scheduled-hint artifacts-status">{t("artifacts.page.loading")}</p>}
        {list && (
          <p className="scheduled-hint artifacts-status" role="status">
            {list.truncated ? t("artifacts.page.truncated", { count: items.length }) : t("artifacts.page.count", { count: visible.length })}
          </p>
        )}
        {list && !listError && items.length === 0 && !search && (
          <div className="scheduled-empty">
            <h3>{t("artifacts.page.emptyTitle")}</h3>
            <p>{t("artifacts.page.emptyBody")}</p>
          </div>
        )}
        {list && (items.length > 0 || search) && visible.length === 0 && (
          <p className="scheduled-hint artifacts-status">{t("artifacts.page.noMatches")}</p>
        )}
        <ul className={`artifacts-list${loading && list ? " is-loading" : ""}`}>
          {visible.map((item) => {
            const key = artifactKey(item);
            const meta = [
              ARTIFACT_TYPE_LABEL[item.type],
              item.sessionTitle,
              formatRelativeTime(item.updated, locale),
            ].join(" · ");
            return (
              <li key={key}>
                <button
                  type="button"
                  className="artifacts-item"
                  aria-current={key === selectedKey ? "true" : undefined}
                  onClick={() => selectItem(item)}
                >
                  <ArtifactThumbnail item={item} scrollRoot={listPaneRef} />
                  <span className="artifacts-item-main">
                    <span className="artifacts-item-title">{item.title}</span>
                    <span className="artifacts-item-meta" title={meta}>{meta}</span>
                    {item.snippet && (
                      <span className="artifacts-item-snippet">
                        {item.snippet.before}<mark>{item.snippet.match}</mark>{item.snippet.after}
                      </span>
                    )}
                  </span>
                  <span className="artifacts-item-tags">
                    {item.scheduled && <span className="scheduled-tag">{t("artifacts.page.scheduled")}</span>}
                    {item.versionCount > 1 && <span className="scheduled-tag">{t("artifacts.page.versionCount", { count: item.versionCount })}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="artifacts-detail-pane">
        {current ? (
          <>
            <div className="artifacts-detail-source">
              <button type="button" className="scheduled-back artifacts-back" onClick={() => selectItem(null)}>
                ← {t("artifacts.page.back")}
              </button>
              <span className="artifacts-detail-session" title={current.sessionTitle}>
                {current.sessionTitle} · {formatRelativeTime(current.updated, locale)}
              </span>
            </div>
            {continueVersion && (
              <form className="artifacts-continue" onSubmit={(event) => void submitContinue(event)}>
                <label className="scheduled-hint" htmlFor="artifacts-continue-input">
                  {t("artifacts.page.continueLabel", { title: continueVersion.title, version: (continueIndex ?? 0) + 1 })}
                </label>
                <textarea
                  id="artifacts-continue-input"
                  className="scheduled-input scheduled-textarea"
                  rows={2}
                  autoFocus
                  value={continueText}
                  disabled={continueBusy}
                  placeholder={t("artifacts.page.continuePlaceholder")}
                  onChange={(event) => setContinueText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey && !isImeComposing(event.nativeEvent)) {
                      event.preventDefault();
                      void submitContinue();
                    } else if (event.key === "Escape") {
                      setContinueIndex(null);
                    }
                  }}
                />
                <div className="scheduled-actions">
                  <button type="button" className="scheduled-button scheduled-button--small" disabled={continueBusy} onClick={() => setContinueIndex(null)}>
                    {t("artifacts.page.cancel")}
                  </button>
                  <button type="submit" className="scheduled-button scheduled-button--small scheduled-button--primary" disabled={continueBusy || !continueText.trim()}>
                    {continueBusy ? t("artifacts.page.continueSending") : t("artifacts.page.continueSend")}
                  </button>
                </div>
              </form>
            )}
            {actionError && <p className="scheduled-error artifacts-detail-error" role="alert">{actionError}</p>}
            <div className="artifacts-detail-body">
              <ArtifactView
                key={selectedKey}
                identifier={current.identifier}
                title={current.title}
                versions={versions}
                holdActiveContent
                emptyMessage={detailMessage}
                versionNote={(index) => (versions?.[index] && !versions[index].onActiveBranch ? t("artifacts.page.otherBranch") : null)}
                renderControls={(index) => {
                  const version = versions?.[index];
                  if (!version) return null;
                  const label = version.onActiveBranch ? t("artifacts.page.openInConversation") : t("artifacts.page.otherBranchHint");
                  return (
                    <>
                      <button
                        type="button"
                        className="file-viewer-icon-button"
                        onClick={() => {
                          setActionError(null);
                          setContinueIndex((open) => (open === index ? null : index));
                        }}
                        aria-pressed={continueIndex === index}
                        title={t("artifacts.page.continueInNewChat")}
                        aria-label={t("artifacts.page.continueInNewChat")}
                      >
                        <svg {...ARTIFACT_TOOLBAR_ICON}>
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="file-viewer-icon-button"
                        onClick={() => void openInConversation(version)}
                        disabled={!version.onActiveBranch}
                        title={label}
                        aria-label={label}
                      >
                        <svg {...ARTIFACT_TOOLBAR_ICON}>
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        </svg>
                      </button>
                    </>
                  );
                }}
              />
            </div>
          </>
        ) : (
          <div className="artifacts-detail-empty">
            <p>{t("artifacts.page.selectHint")}</p>
          </div>
        )}
      </div>
    </section>
  );
}
