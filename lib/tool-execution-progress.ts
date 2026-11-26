const MAX_PROGRESS_LENGTH = 500;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The pi-subagents tool reports running children in its live result details. */
export function getRunningPiSubagents(partialResult: unknown): number | undefined {
  if (!isObject(partialResult) || !isObject(partialResult.details)) return undefined;
  const { progress, workflowChildren } = partialResult.details;
  if (isObject(workflowChildren) && Array.isArray(workflowChildren.children)) {
    return workflowChildren.children.filter((child) => isObject(child) && child.state === "running").length;
  }
  if (Array.isArray(progress)) {
    return progress.filter((child) => isObject(child) && child.status === "running").length;
  }
  return undefined;
}

export function getToolExecutionProgress(partialResult: unknown): string | null {
  if (!isObject(partialResult)) return null;

  const content = partialResult.content;
  if (!Array.isArray(content)) return null;

  const text = content
    .filter((block) => isObject(block) && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n");
  const lines = text.split(/\r?\n/);
  let latest = "";
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    latest = lines[index].trim();
    if (latest) break;
  }
  if (!latest) return null;

  const normalized = latest.replace(/\s+/g, " ");
  return normalized.length <= MAX_PROGRESS_LENGTH
    ? normalized
    : `...${normalized.slice(-(MAX_PROGRESS_LENGTH - 3))}`;
}
