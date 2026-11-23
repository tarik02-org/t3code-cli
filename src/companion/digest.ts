import { type CompanionEvent, isActionable, type ThreadRef } from "./schema.ts";

/** A digest's whole text stays under this; last messages are cut to make it fit. */
export const digestLength = 30_000;
const leastMessageLength = 1_500;

/** How a digest opens. The companion looks for it to learn whether a send arrived. */
export const digestTag = (id: number) => `t3 companion digest ${id}:`;

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

const quote = (text: string) =>
  text
    .split("\n")
    .map((line) => `  > ${line}`)
    .join("\n");

function eventLines(event: CompanionEvent, messageLength: number): Array<string> {
  const { payload } = event;
  const lines = [
    `- ${event.kind.toUpperCase()}${isActionable(event.kind) ? "" : " (for information)"} [${event.id}]: ${payload.summary}`,
  ];
  for (const check of payload.failing ?? []) {
    if (check.url !== null) {
      lines.push(`  ${check.name}: ${check.url}`);
    }
  }
  if (payload.remark !== undefined) {
    lines.push(`  ${payload.remark.url}`);
  }
  const linked = (payload.pullRequests ?? []).map(
    (pr) =>
      `${pr.url}${pr.head === null ? "" : ` at ${pr.head.slice(0, 7)}`}${pr.state === null ? "" : ` (${pr.state})`}`,
  );
  if (linked.length > 0) {
    lines.push(`  Pull requests: ${linked.join(", ")}`);
  }
  if (typeof payload.lastMessage === "string" && payload.lastMessage.length > 0) {
    const cut = payload.lastMessage.length > messageLength;
    lines.push(
      `  Its last message${cut ? ` (first ${messageLength} of ${payload.lastMessage.length} characters)` : ""}:`,
      quote(cut ? payload.lastMessage.slice(0, messageLength) : payload.lastMessage),
    );
  }
  return lines;
}

const heading = (event: CompanionEvent) => {
  const what = event.subject.startsWith("thread:")
    ? "Thread"
    : event.subject.startsWith("pr:")
      ? `PR ${event.subject.slice("pr:".length)}`
      : "Reminder";
  const link = event.payload.link === null ? "" : ` ${event.payload.link}`;
  return `${what} "${event.payload.title}"${link}`;
};

const urgency = (group: { readonly events: ReadonlyArray<CompanionEvent> }) =>
  Number(group.events.some((event) => event.urgent));

/**
 * One message for everything pending: a block per thread, pull request or reminder, with its
 * events in the order they happened. Blocks that hold an urgent event come first.
 */
export function formatDigest(
  id: number,
  caller: ThreadRef,
  events: ReadonlyArray<CompanionEvent>,
): string {
  const groups = new Map<
    string,
    { readonly first: CompanionEvent; events: Array<CompanionEvent> }
  >();
  for (const event of events) {
    const group = groups.get(event.subject);
    if (group === undefined) {
      groups.set(event.subject, { first: event, events: [event] });
    } else {
      group.events.push(event);
    }
  }
  const ordered = [...groups.values()].toSorted((left, right) => urgency(right) - urgency(left));
  const render = (messageLength: number) => {
    const lines = [
      `${digestTag(id)} ${count(events.length, "event")} on ${count(ordered.length, "object")}.`,
    ];
    for (const group of ordered) {
      lines.push("", heading(group.first));
      for (const event of group.events) {
        lines.push(...eventLines(event, messageLength));
      }
    }
    lines.push(
      "",
      `An event's whole payload: events ${JSON.stringify({
        callerThreadId: caller.threadId,
        callerEnvironment: caller.environment,
        id: events[0]?.id,
      })}. What you watch: watching.`,
    );
    return lines.join("\n");
  };
  const whole = render(Number.POSITIVE_INFINITY);
  if (whole.length <= digestLength) {
    return whole;
  }
  const messages = events.filter((event) => typeof event.payload.lastMessage === "string").length;
  // A cut message still costs the line that introduces it and its quote marks.
  const spare = digestLength - render(0).length - messages * 200;
  return render(Math.max(leastMessageLength, Math.floor(spare / Math.max(messages, 1))));
}

/** What the companion does with a caller's pending events right now. */
export type Delivery =
  | { readonly action: "wait" }
  | { readonly action: "send"; readonly mode: "auto" | "steer" };

/** Events this close together reach their caller as one message. */
export const debounceMs = 5_000;
/** A burst of events does not put a digest off for longer than this. */
export const longestDebounceMs = 30_000;
/** A digest held because its caller's turn runs on is steered in after this long. */
export const longestHoldMs = 30 * 60_000;

/**
 * Decides from the current state alone, so a digest held for a turn goes out as soon as any
 * look at the caller finds the turn over, whatever told the companion so.
 */
export function decideDelivery(input: {
  readonly events: ReadonlyArray<Pick<CompanionEvent, "at" | "urgent">>;
  readonly callerInTurn: boolean;
  readonly nowMs: number;
}): Delivery {
  const times = input.events.map((event) => Date.parse(event.at));
  if (times.length === 0) {
    return { action: "wait" };
  }
  const oldest = Math.min(...times);
  const newest = Math.max(...times);
  if (input.nowMs - newest < debounceMs && input.nowMs - oldest < longestDebounceMs) {
    return { action: "wait" };
  }
  if (!input.callerInTurn) {
    return { action: "send", mode: "auto" };
  }
  return input.events.some((event) => event.urgent) || input.nowMs - oldest >= longestHoldMs
    ? { action: "send", mode: "steer" }
    : { action: "wait" };
}
