import type { OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Option from "effect/Option";

import { CompanionEnvironments } from "./environments.ts";
import { threadRefKey, type DeliveryPriority, type InboxEvent, type ThreadRef } from "./schema.ts";
import { inTurn, pullRequestSummaries } from "./state.ts";
import { CompanionStore } from "./store.ts";

export const wakeCoalesceWindow = Duration.seconds(5);

const priorityRank: Record<DeliveryPriority, number> = { urgent: 0, normal: 1, low: 2 };

function formatDigestItem(row: InboxEvent): string {
  const event = row.event;
  const source = `${event.environment}${event.threadId === null ? "" : `/${event.threadId}`}`;
  const redelivered = row.redelivered > 0 ? ", snoozed item back" : "";
  const lines = [
    `- [${row.id}] ${row.priority} ${event.kind}${event.pause ? " (pause)" : ""}${redelivered}: "${event.title}" (${source}) ${event.summary}`,
  ];
  for (const pr of event.pullRequests) {
    lines.push(
      `    PR #${pr.number} ${pr.state}${pr.draft ? " draft" : ""}, checks ${pr.checks ?? "unknown"}, ${pr.mergeable ?? "mergeability unknown"}: ${pr.url}`,
    );
  }
  if (event.lastMessage !== null) {
    lines.push(
      "    last message:",
      ...event.lastMessage.split("\n").map((line) => `      ${line}`),
    );
  }
  return lines.join("\n");
}

function formatDigest(rows: ReadonlyArray<InboxEvent>): string {
  return [
    `t3 companion: ${rows.length} subscribed thread event${rows.length === 1 ? "" : "s"}.`,
    ...rows.map(formatDigestItem),
    "Full messages are in inbox_list. Close items with inbox_resolve, or inbox_snooze them until the source is idle again.",
  ].join("\n");
}

/**
 * Sends each subscriber its unannounced inbox items as one message per coalescing window.
 * `latestShell` gives the last shell row the watcher saw of a thread, if any.
 */
export const makeDigests = Effect.fn("makeCompanionDigests")(function* (
  latestShell: (ref: ThreadRef) => Effect.Effect<OrchestrationV2ThreadShell | undefined>,
) {
  const store = yield* CompanionStore;
  const environments = yield* CompanionEnvironments;
  const windows = yield* FiberMap.make<string>();

  /**
   * Re-checks each item against its source's latest shell row: an idle or settled the source
   * moved past (a newer run) is resolved as superseded, and PR states are brought up to date.
   */
  const freshen = Effect.fn("CompanionDigests.freshen")(function* (
    rows: ReadonlyArray<InboxEvent>,
  ) {
    const kept: Array<InboxEvent> = [];
    for (const row of rows) {
      const event = row.event;
      const latest =
        event.threadId === null
          ? undefined
          : yield* latestShell({ environment: event.environment, threadId: event.threadId });
      if (latest === undefined) {
        kept.push(row);
        continue;
      }
      const runId = event.runId ?? null;
      if (
        (event.kind === "idle" || event.kind === "settled") &&
        runId !== null &&
        latest.latestRunId !== runId
      ) {
        yield* store.resolve({
          subscriber: row.subscriber,
          ids: [row.id],
          disposition: "auto: superseded, the source started a new run",
        });
        continue;
      }
      const now = pullRequestSummaries(latest);
      const pullRequests = event.pullRequests.map(
        (pr) =>
          now.find(
            (candidate) => candidate.number === pr.number && candidate.repository === pr.repository,
          ) ?? pr,
      );
      const refreshed = event.kind === "pr-checks" ? pullRequests : now;
      if (JSON.stringify(refreshed) === JSON.stringify(event.pullRequests)) {
        kept.push(row);
        continue;
      }
      const updated = { ...event, pullRequests: refreshed };
      yield* store.updateEvent(row.id, updated);
      kept.push({ ...row, event: updated });
    }
    return kept;
  });

  const send = Effect.fn("CompanionDigests.send")(function* (subscriber: ThreadRef) {
    const pending = (yield* freshen(yield* store.pendingDigest(subscriber))).toSorted((a, b) =>
      a.priority === b.priority ? a.id - b.id : priorityRank[a.priority] - priorityRank[b.priority],
    );
    const first = pending[0];
    if (first === undefined || pending.every((row) => row.passive)) {
      return false;
    }
    // The companion holds the batch itself while the subscriber works, rather than piling one
    // T3 Code queued turn per event behind it: only urgent items steer into a running turn,
    // carrying everything else pending; the rest go out as one new turn once it ends.
    const shell = yield* latestShell(subscriber);
    const busy = shell !== undefined && inTurn(shell, yield* Clock.currentTimeMillis);
    if (busy && first.priority !== "urgent") {
      return false;
    }
    const environment = yield* environments.resolve(subscriber.environment);
    const message = formatDigest(pending);
    const mode = first.priority === "urgent" ? "steer" : "auto";
    // Through T3 Code's MCP the digest shows as from an agent; a websocket send shows as the user's.
    const asAgent = yield* Option.match(environment.agentSender, {
      onNone: () => Effect.succeed(false),
      onSome: (sender) =>
        sender.send({ threadId: subscriber.threadId, message, mode }).pipe(
          Effect.as(true),
          Effect.catchCause((cause) =>
            Effect.logWarning(
              `agent-marked digest to ${threadRefKey(subscriber)} failed; sending it as a plain message`,
              cause,
            ).pipe(Effect.as(false)),
          ),
        ),
    });
    if (!asAgent) {
      yield* environment.application.sendThread({
        threadId: subscriber.threadId,
        message,
        mode,
        author: { kind: "agent" },
      });
    }
    yield* store.markWoken(pending.map((row) => row.id));
    yield* Effect.logInfo(
      `sent ${first.priority} digest to ${threadRefKey(subscriber)} for inbox ${pending.map((row) => row.id).join(", ")}`,
    );
    return true;
  });

  // One digest per window: events that land while a digest is pending join it, and events
  // that land during the send start the next window.
  const schedule = (subscriber: ThreadRef) =>
    FiberMap.run(
      windows,
      threadRefKey(subscriber),
      Effect.gen(function* () {
        let sent = true;
        while (sent) {
          yield* Effect.sleep(wakeCoalesceWindow);
          sent = yield* send(subscriber);
        }
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning(
            `wake digest to ${threadRefKey(subscriber)} failed; it stays pending`,
            cause,
          ),
        ),
      ),
      { onlyIfMissing: true },
    ).pipe(Effect.asVoid);

  return { schedule };
});
