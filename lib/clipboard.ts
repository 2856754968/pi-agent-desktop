import { isTauriDesktop } from "@/lib/desktop-updater";

function copyWithExecCommand(text: string): void {
  const active = document.activeElement;
  const selection = window.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
  const inputSelection = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
    ? { start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection }
    : null;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;";
  // A modal dialog makes nodes outside it inert, so a body-level textarea cannot
  // take focus or replace the user's selection there.
  const host = active instanceof Element ? active.closest("dialog[open]") : null;
  (host ?? document.querySelector("dialog[open]") ?? document.body).appendChild(ta);
  let wroteText = false;
  const onCopy = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    event.clipboardData.setData("text/plain", text);
    event.preventDefault();
    event.stopImmediatePropagation();
    wroteText = true;
  };
  // Own this copy operation: an existing DOM/input selection must never replace
  // the explicit content supplied by a message or code-block copy button.
  window.addEventListener("copy", onCopy, true);
  try {
    ta.focus({ preventScroll: true });
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    if (!ok || !wroteText) throw new Error("Copy failed");
  } finally {
    window.removeEventListener("copy", onCopy, true);
    ta.remove();
    if (active instanceof HTMLElement && active.isConnected) {
      active.focus({ preventScroll: true });
    }
    selection?.removeAllRanges();
    for (const range of ranges) selection?.addRange(range);
    // DOM range restoration can reset an input's selection in Chromium.
    if (inputSelection && active instanceof HTMLElement && active.isConnected
      && inputSelection.start !== null && inputSelection.end !== null) {
      (active as HTMLInputElement | HTMLTextAreaElement).setSelectionRange(inputSelection.start, inputSelection.end, inputSelection.direction ?? undefined);
    }
  }
}

/** Copy text to the system clipboard (Tauri plugin on desktop, Clipboard API on web). */
export async function copyText(text: string): Promise<void> {
  if (isTauriDesktop()) {
    try {
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(text);
      return;
    } catch {
      // fall through to browser APIs
    }
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // fall through
    }
  }

  await copyWithExecCommand(text);
}
