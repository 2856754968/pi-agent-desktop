import type { EventBus } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";

const RPC = "subagents:rpc:v1";
const ACTIVITY_EVENTS = [
  `${RPC}:ready`,
  "subagent:async-started",
  "subagent:async-complete",
  "subagent:jobs-changed",
  "subagent:child-status",
  "subagent:process-terminal",
];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function countRunningChildren(nodes: unknown[]): number {
  let count = 0;
  for (const node of nodes) {
    if (!isObject(node) || node.kind === "host-step") continue;
    if (Array.isArray(node.children) && node.children.length > 0) {
      count += countRunningChildren(node.children);
    } else if (node.state === "running" && (node.kind === "subagent" || node.kind === "step")) {
      count += 1;
    }
  }
  return count;
}

/** Read the package's session-scoped async snapshot after lifecycle changes. */
export function subscribePiSubagentActivity(events: EventBus, onCount: (count: number) => void): () => void {
  let scheduled: ReturnType<typeof setTimeout> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let removeReply: (() => void) | undefined;
  let refreshPending = false;

  const finishRequest = () => {
    removeReply?.();
    removeReply = undefined;
    clearTimeout(timeout);
    timeout = undefined;
  };

  const schedule = () => {
    if (removeReply) {
      refreshPending = true;
      return;
    }
    if (scheduled) return;
    scheduled = setTimeout(() => {
      scheduled = undefined;
      const requestId = randomUUID();
      const complete = () => {
        finishRequest();
        if (refreshPending) {
          refreshPending = false;
          schedule();
        }
      };
      removeReply = events.on(`${RPC}:reply:${requestId}`, (reply) => {
        complete();
        if (!isObject(reply) || reply.success !== true || !isObject(reply.data)) return;
        const snapshot = reply.data.asyncSnapshot;
        if (isObject(snapshot) && snapshot.version === 1 && Array.isArray(snapshot.runs)) {
          onCount(countRunningChildren(snapshot.runs));
        }
      });
      timeout = setTimeout(complete, 3_000);
      events.emit(`${RPC}:request`, { version: 1, requestId, method: "status", params: {} });
    }, 250);
  };

  const unsubscribes = ACTIVITY_EVENTS.map((event) => events.on(event, schedule));
  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
    clearTimeout(scheduled);
    finishRequest();
  };
}
