import * as DateTime from "effect/DateTime";
import * as Predicate from "effect/Predicate";

/** The fields of a transcript item the scan reads; T3 Code's turn items have them all. */
export interface ScannedItem {
  readonly type: string;
  readonly ordinal: number;
  readonly status: string;
  readonly startedAt?: DateTime.Utc | null;
  readonly toolName?: string | null;
  readonly input?: unknown;
  readonly output?: unknown;
}

/** A thread the caller launched or wrote to, as one of its tool calls names it. */
export interface SentTarget {
  readonly threadId: string;
  readonly origin: "launched" | "sent";
  /** When the tool call began: what the thread does after it is the caller's to hear. */
  readonly atMs: number;
  /** Where in the transcript the tool call is. */
  readonly ordinal: number;
}

const unfinished: ReadonlySet<string> = new Set(["idle", "pending", "running", "waiting"]);

// The MCP server's name prefixes the tool: `mcp__agx-t3__t3_thread_send`, `mcp__t3-code__…`.
const toolOf = (name: string) =>
  /(?:^|__)(t3_thread_launch|t3_thread_send|t3_thread_send_attachments|create_threads)$/.exec(
    name,
  )?.[1];

const threadIdOf = (value: unknown) =>
  Predicate.hasProperty(value, "threadId") && typeof value.threadId === "string"
    ? [value.threadId]
    : [];

/**
 * The threads a caller's tool calls launched or wrote to, among the items after `cursor`, and
 * the cursor to continue from. The cursor stops before a tool call that has not finished, so
 * its target is read once it has.
 */
export function sentTargets(
  items: ReadonlyArray<ScannedItem>,
  cursor: number,
): { readonly targets: ReadonlyArray<SentTarget>; readonly cursor: number } {
  const targets: Array<SentTarget> = [];
  let next = cursor;
  for (const item of items.toSorted((left, right) => left.ordinal - right.ordinal)) {
    if (item.ordinal <= cursor) {
      continue;
    }
    const tool =
      item.type === "dynamic_tool" && typeof item.toolName === "string"
        ? toolOf(item.toolName)
        : undefined;
    if (tool !== undefined && unfinished.has(item.status)) {
      break;
    }
    next = item.ordinal;
    if (tool === undefined || item.status !== "completed") {
      continue;
    }
    const atMs =
      item.startedAt === null || item.startedAt === undefined
        ? 0
        : DateTime.toEpochMillis(item.startedAt);
    const created =
      Predicate.hasProperty(item.output, "threads") && Array.isArray(item.output.threads)
        ? item.output.threads.flatMap(threadIdOf)
        : threadIdOf(item.output);
    const launches = tool === "t3_thread_launch" || tool === "create_threads";
    for (const threadId of launches ? created : threadIdOf(item.input)) {
      targets.push({
        threadId,
        origin: launches ? "launched" : "sent",
        atMs,
        ordinal: item.ordinal,
      });
    }
  }
  return { targets, cursor: next };
}
