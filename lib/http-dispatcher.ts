import { EventEmitter } from "node:events";
import { join } from "node:path";
import * as undici from "undici";
import { getAgentDir } from "./pi-agent-dir";
import { readRegularFileText } from "./regular-file";

export const DEFAULT_HTTP_IDLE_TIMEOUT_MS = 300_000;

type DispatcherGlobal = typeof globalThis & {
  __piWebHttpDispatcherConfigured?: boolean;
  __piWebHttpDispatcher?: undici.Dispatcher;
  __piWebHttpDispatcherTimeoutMs?: number;
};

const dispatcherGlobal = globalThis as DispatcherGlobal;
const originalGlobalFetch = globalThis.fetch;
const ignoreUndiciDispatcherError = (): void => {};

function parseHttpIdleTimeoutMs(value: unknown): number | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.toLowerCase() === "disabled") return 0;
    if (trimmed.length === 0) return undefined;
    return parseHttpIdleTimeoutMs(Number(trimmed));
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.floor(value);
}

/**
 * The global `httpIdleTimeoutMs`, read the way the pi CLI reads it, so a Web UI
 * session gets the HTTP idle timeout the user configured instead of the
 * built-in default. Only the global file counts: the dispatcher is configured
 * once at startup, before any project is selected, so a project's
 * `.pi/settings.json` cannot apply here.
 *
 * A missing file, a file that does not parse, an absent key, or a value the CLI
 * would reject yields `undefined`, which leaves `configureHttpDispatcher`'s own
 * default in place.
 */
export function readHttpIdleTimeoutMs(agentDir: string = getAgentDir()): number | undefined {
  let text: string | undefined;
  try {
    text = readRegularFileText(join(agentDir, "settings.json"));
  } catch {
    return undefined;
  }
  if (text === undefined) return undefined;

  let settings: unknown;
  try {
    settings = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return undefined;
  }
  if (typeof settings !== "object" || settings === null) return undefined;

  return parseHttpIdleTimeoutMs((settings as { httpIdleTimeoutMs?: unknown }).httpIdleTimeoutMs);
}

// Undici can emit an internal Client error while terminating a response body.
// The body stream still rejects; this prevents the EventEmitter error from
// terminating the Next.js process first.
function withUndiciErrorListener<T extends undici.Dispatcher>(dispatcher: T): T {
  if (dispatcher instanceof EventEmitter) {
    EventEmitter.prototype.on.call(dispatcher, "error", ignoreUndiciDispatcherError);
  }
  return dispatcher;
}

function createUndiciClient(origin: string | URL, options: object): undici.Dispatcher {
  return withUndiciErrorListener(
    new undici.Client(origin, options as undici.Client.Options),
  );
}

function createUndiciOriginDispatcher(origin: string | URL, options: object): undici.Dispatcher {
  const dispatcherOptions = options as undici.Pool.Options;
  if (dispatcherOptions.connections === 1) {
    return createUndiciClient(origin, dispatcherOptions);
  }

  return withUndiciErrorListener(
    new undici.Pool(origin, {
      ...dispatcherOptions,
      factory: createUndiciClient,
    }),
  );
}

function createProxyAwareDispatcher(timeoutMs: number): undici.Dispatcher {
  // EnvHttpProxyAgent reads HTTP(S)_PROXY when it is built (NO_PROXY on every
  // request), so a proxy change in Settings rebuilds it; see lib/network-proxy.ts.
  return withUndiciErrorListener(
    new undici.EnvHttpProxyAgent({
      allowH2: false,
      // Reach an http:// origin through a CONNECT tunnel, as the pi SDK's own
      // dispatcher does. A forwarded request is carried by a client that keeps
      // undici's own 300 s bodyTimeout, so `httpIdleTimeoutMs` would not apply
      // and a provider stream that stalls cannot be cut at the configured time.
      proxyTunnel: true,
      bodyTimeout: timeoutMs,
      // Node's 250 ms default can terminate valid connection attempts on
      // high-latency routes; the pi CLI's dispatcher waits two seconds here.
      connect: { autoSelectFamilyAttemptTimeout: 2_000 },
      headersTimeout: timeoutMs,
      clientFactory: createUndiciClient,
      factory: createUndiciOriginDispatcher,
    }),
  );
}

export function configureHttpDispatcher(
  timeoutMs: number = DEFAULT_HTTP_IDLE_TIMEOUT_MS,
): void {
  if (dispatcherGlobal.__piWebHttpDispatcherConfigured) return;

  const normalizedTimeoutMs = parseHttpIdleTimeoutMs(timeoutMs);
  if (normalizedTimeoutMs === undefined) {
    throw new Error(`Invalid HTTP idle timeout: ${String(timeoutMs)}`);
  }

  const dispatcher = createProxyAwareDispatcher(normalizedTimeoutMs);
  undici.setGlobalDispatcher(dispatcher);
  dispatcherGlobal.__piWebHttpDispatcher = dispatcher;
  dispatcherGlobal.__piWebHttpDispatcherTimeoutMs = normalizedTimeoutMs;

  // Keep fetch and the dispatcher on the same undici implementation. Preserve
  // an intentional fetch override installed after this module was loaded.
  if (globalThis.fetch === originalGlobalFetch) {
    undici.install?.();
  }

  dispatcherGlobal.__piWebHttpDispatcherConfigured = true;
}

/**
 * Rebuild the global dispatcher from the current proxy environment. Requests
 * already in flight (streaming replies included) finish on the old dispatcher,
 * which closes once they are done. A no-op before configureHttpDispatcher().
 */
export function reconfigureHttpDispatcher(): void {
  if (!dispatcherGlobal.__piWebHttpDispatcherConfigured) return;
  const timeoutMs = dispatcherGlobal.__piWebHttpDispatcherTimeoutMs ?? DEFAULT_HTTP_IDLE_TIMEOUT_MS;
  const previous = dispatcherGlobal.__piWebHttpDispatcher;
  const dispatcher = createProxyAwareDispatcher(timeoutMs);
  undici.setGlobalDispatcher(dispatcher);
  dispatcherGlobal.__piWebHttpDispatcher = dispatcher;
  if (previous && previous !== dispatcher) {
    void previous.close().catch(ignoreUndiciDispatcherError);
  }
}
