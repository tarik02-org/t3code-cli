import type { OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Option from "effect/Option";

import { itemWakes } from "./delivery.ts";
import { CompanionEnvironments } from "./environments.ts";
import {
  threadRefKey,
  type DeliveryPriority,
  type InboxEvent,
  type PullRequestSummary,
  type ThreadRef,
} from "./schema.ts";
import { checksMovedOn, inTurn, isLive, pullRequestSummaries } from "./state.ts";
import { CompanionStore } from "./store.ts";

export const wakeCoalesceWindow = Duration.seconds(5);
/** The most passive items a digest lists one by one; the rest are counted. */
const passiveListLimit = 20;
/** How much of its last message's first line a passive item's line quotes. */
const passiveOpeningLength = 120;

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

interface DisarmedSubscription {
  readonly id: number;
  readonly label: string;
  /** Open passive items this subscription has delivered. */
  readonly waiting: number;
}

/** What the subscriber is left to do after a digest; a wake spends its subscription's arm. */
interface DigestActions {
  readonly subscriber: ThreadRef;
  /** Subscriptions this digest's waking items disarmed. */
  readonly spent: ReadonlyArray<DisarmedSubscription>;
  /** Subscriptions disarmed earlier whose source can still produce events. */
  readonly stillDisarmed: ReadonlyArray<DisarmedSubscription>;
  /** One line per open passive item, oldest first. */
  readonly passive: ReadonlyArray<string>;
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

const pullRequestNote = (pr: PullRequestSummary) =>
  pr.state === "open"
    ? `PR #${pr.number} ${pr.draft ? "draft" : "ready"}, checks ${pr.checks ?? "unknown"}`
    : `PR #${pr.number} ${pr.state}`;

const subscriptionLine = (subscription: DisarmedSubscription) =>
  `    ${subscription.id} ${subscription.label}${
    subscription.waiting === 0 ? "" : `, ${count(subscription.waiting, "passive item")} waiting`
  }`;

function formatActions(actions: DigestActions): Array<string> {
  const lines = [
    "Actions:",
    "- Close what you have handled with inbox_resolve, or inbox_snooze it until the source is idle again. Full messages are in inbox_list.",
  ];
  if (actions.spent.length > 0) {
    lines.push(
      `- This wake disarmed ${count(actions.spent.length, "subscription")}; later events from there will not wake you:`,
      ...actions.spent.map(subscriptionLine),
    );
  }
  if (actions.stillDisarmed.length > 0) {
    lines.push(
      `- Disarmed earlier and still disarmed, though the source is active: ${count(actions.stillDisarmed.length, "subscription")}:`,
      ...actions.stillDisarmed.map(subscriptionLine),
    );
  }
  const ids = [...actions.spent, ...actions.stillDisarmed].map((subscription) => subscription.id);
  lines.push(
    ids.length === 0
      ? "- No subscription with an active source is disarmed."
      : `- Re-arm the ones you still want wakes from: arm ${JSON.stringify({
          callerThreadId: actions.subscriber.threadId,
          callerEnvironment: actions.subscriber.environment,
          ids,
        })}`,
  );
  if (actions.passive.length > 0) {
    const hidden = actions.passive.length - passiveListLimit;
    lines.push(
      `- Open in your inbox without having woken you: ${count(actions.passive.length, "passive item")}:`,
      ...actions.passive.slice(0, passiveListLimit),
      ...(hidden > 0 ? [`    and ${hidden} more in inbox_list`] : []),
    );
  }
  return lines;
}

function formatDigest(rows: ReadonlyArray<InboxEvent>, actions: DigestActions): string {
  return [
    `t3 companion: ${count(rows.length, "subscribed thread event")}.`,
    ...rows.map(formatDigestItem),
    ...formatActions(actions),
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
   * moved past (a newer run) is resolved as superseded, so is a question or approval once the
   * source waits on nothing and a pr-checks whose checks moved on, and PR states are brought up
   * to date.
   */
  const freshen = Effect.fn("CompanionDigests.freshen")(function* (
    rows: ReadonlyArray<InboxEvent>,
  ) {
    const kept: Array<InboxEvent> = [];
    // Subscriptions whose waking item was dropped: its wake never happens.
    const freed = new Set<number>();
    const supersede = Effect.fnUntraced(function* (row: InboxEvent, reason: string) {
      yield* store.resolve({
        subscriber: row.subscriber,
        ids: [row.id],
        disposition: `auto: superseded, ${reason}`,
      });
      if (
        row.event.kind !== "stalled" &&
        !row.passive &&
        row.priority !== "urgent" &&
        row.redelivered === 0
      ) {
        freed.add(row.subscriptionId);
      }
    });
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
      // The row shows only one pending request, so only "none pending" proves this one closed.
      if (
        (event.kind === "needs-input" || event.kind === "needs-approval") &&
        latest.pendingRuntimeRequest === null
      ) {
        yield* supersede(row, "the request was answered");
        continue;
      }
      const runId = event.runId ?? null;
      if (
        (event.kind === "idle" || event.kind === "settled" || event.kind === "stalled") &&
        runId !== null &&
        latest.latestRunId !== runId
      ) {
        yield* supersede(row, "the source started a new run");
        continue;
      }
      if (event.kind === "pr-checks" && checksMovedOn(latest, event)) {
        yield* supersede(row, "the pull request's checks moved on");
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
    // A freed wake goes to the newest item that arrived passive only because the arm was spent;
    // with no such item the subscription is armed again.
    const subscriptions = freed.size === 0 ? [] : yield* store.subscriptions;
    for (const id of freed) {
      const subscription = subscriptions.find((candidate) => candidate.id === id);
      if (subscription === undefined) {
        continue;
      }
      const heir = kept.findLastIndex(
        (row) =>
          row.subscriptionId === id &&
          row.passive &&
          itemWakes({ ...subscription, armed: true }, row.event, row.priority),
      );
      const inherited = kept[heir];
      if (inherited === undefined) {
        yield* store.setArmed({ ids: [id], armed: true });
        continue;
      }
      yield* store.makeWaking(inherited.id);
      kept[heir] = { ...inherited, passive: false };
    }
    return kept;
  });

  const actionsFor = Effect.fn("CompanionDigests.actionsFor")(function* (
    subscriber: ThreadRef,
    pending: ReadonlyArray<InboxEvent>,
  ) {
    const nowMs = yield* Clock.currentTimeMillis;
    const passive = yield* store.openPassive(subscriber);
    const spentIds = new Set(
      pending
        .filter((row) => !row.passive && row.priority !== "urgent" && row.redelivered === 0)
        .map((row) => row.subscriptionId),
    );
    const spent: Array<DisarmedSubscription> = [];
    const stillDisarmed: Array<DisarmedSubscription> = [];
    for (const subscription of yield* store.subscriptions) {
      if (
        threadRefKey(subscription.subscriber) !== threadRefKey(subscriber) ||
        !subscription.wake ||
        subscription.armed ||
        subscription.follow
      ) {
        continue;
      }
      const { environment, threadId, projectId } = subscription.source;
      const shell = threadId === null ? undefined : yield* latestShell({ environment, threadId });
      const entry = {
        id: subscription.id,
        label:
          threadId === null
            ? `project ${projectId} (${environment})`
            : `"${shell?.title ?? threadId}" (${environment}/${threadId})`,
        waiting: passive.filter((row) => row.subscriptionId === subscription.id).length,
      };
      if (spentIds.has(subscription.id)) {
        spent.push(entry);
      } else if (threadId === null || (shell !== undefined && isLive(shell, nowMs))) {
        stillDisarmed.push(entry);
      }
    }
    const passiveLines: Array<string> = [];
    for (const { id, event } of passive) {
      const shell =
        event.threadId === null
          ? undefined
          : yield* latestShell({ environment: event.environment, threadId: event.threadId });
      // A PR moves on after the item was written; say where it stands now.
      const pullRequests =
        shell === undefined || event.kind === "pr-checks"
          ? event.pullRequests
          : pullRequestSummaries(shell);
      const opening = event.lastMessage?.trim().split("\n")[0]?.slice(0, passiveOpeningLength);
      passiveLines.push(
        [
          `    [${id}] ${event.kind}${event.pause ? " (pause)" : ""} "${event.title}": ${event.summary}`,
          ...pullRequests.map(pullRequestNote),
        ].join("; ") + (opening === undefined || opening === "" ? "" : ` | ${opening}`),
      );
    }
    return { subscriber, spent, stillDisarmed, passive: passiveLines } satisfies DigestActions;
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
    const message = formatDigest(pending, yield* actionsFor(subscriber, pending));
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
