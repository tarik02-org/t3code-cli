import type { OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";

import { CompanionEnvironments } from "./environments.ts";
import { CompanionInvalidRequestError, type CompanionStoreError } from "./error.ts";
import {
  environmentEventKinds,
  type CompanionEventKind,
  type DeliveryPriority,
  type InboxEvent,
  type OpenWorkItem,
  type Subscription,
  type SubscriptionSource,
  type ThreadEvent,
  type ThreadRef,
  type ThreadStatus,
} from "./schema.ts";
import {
  busyReasons,
  checksTransitions,
  deliveryPriority,
  pullRequestSummaries,
  idleCandidate,
  immediateEvents,
  readyToMark,
  threadStatus,
} from "./state.ts";
import { CompanionStore } from "./store.ts";

export const wakeCoalesceWindow = Duration.seconds(5);
export const maxWaitSeconds = 600;
/** How often snoozed items are checked for their time having passed. */
export const snoozeCheckInterval = Duration.seconds(15);
/** The longest last message an event carries; digests include it whole. */
export const lastMessageLength = 10_000;

export interface ThreadRefInput {
  readonly environment?: string | undefined;
  readonly threadId: string;
}

export interface SubscribeInput {
  readonly subscriber: ThreadRefInput;
  readonly source: {
    readonly environment?: string | undefined;
    readonly threadId?: string | undefined;
    readonly projectId?: string | undefined;
  };
  readonly events: ReadonlyArray<CompanionEventKind>;
  readonly wake: boolean;
  readonly priorities: Readonly<Record<string, DeliveryPriority>>;
  /** With a project source: follow the subscriber's own new threads in it instead. */
  readonly follow?: boolean | undefined;
}

export interface SubscribeResult {
  readonly subscription: Subscription;
  /** The source thread's state when the subscription was made; null for a project or unknown thread. */
  readonly source: ThreadStatus | null;
}

export interface WaitInput {
  readonly subscriber: ThreadRef;
  readonly afterId: number;
  readonly kinds: ReadonlyArray<CompanionEventKind>;
  readonly timeout: Duration.Duration;
}

export interface Relevance {
  /** Some subscription wants this thread's events. */
  readonly source: boolean;
  /** The thread subscribes to something, so its turn ends gate low-priority digests. */
  readonly subscriber: boolean;
}

export class CompanionHub extends Context.Service<
  CompanionHub,
  {
    /** Resolves env aliases to the canonical name the store keys on. */
    readonly normalizeRef: (
      ref: ThreadRefInput,
    ) => Effect.Effect<ThreadRef, CompanionInvalidRequestError>;
    readonly subscribe: (
      input: SubscribeInput,
    ) => Effect.Effect<SubscribeResult, CompanionInvalidRequestError | CompanionStoreError>;
    readonly unsubscribe: (input: {
      readonly subscriber: ThreadRefInput;
      readonly ids: ReadonlyArray<number>;
    }) => Effect.Effect<number, CompanionInvalidRequestError | CompanionStoreError>;
    readonly listSubscriptions: (
      subscriber: ThreadRefInput,
    ) => Effect.Effect<
      ReadonlyArray<Subscription>,
      CompanionInvalidRequestError | CompanionStoreError
    >;
    readonly listInbox: (input: {
      readonly subscriber: ThreadRefInput;
      readonly includeResolved: boolean;
      readonly afterId: number;
      readonly limit: number;
    }) => Effect.Effect<
      ReadonlyArray<InboxEvent>,
      CompanionInvalidRequestError | CompanionStoreError
    >;
    readonly resolve: (input: {
      readonly subscriber: ThreadRefInput;
      readonly ids: ReadonlyArray<number>;
      readonly disposition: string | null;
    }) => Effect.Effect<number, CompanionInvalidRequestError | CompanionStoreError>;
    readonly snooze: (input: {
      readonly subscriber: ThreadRefInput;
      readonly ids: ReadonlyArray<number>;
      readonly minSeconds: number;
    }) => Effect.Effect<number, CompanionInvalidRequestError | CompanionStoreError>;
    readonly wait: (input: {
      readonly subscriber: ThreadRefInput;
      readonly afterId: number;
      readonly kinds: ReadonlyArray<CompanionEventKind>;
      readonly timeout: Duration.Duration;
    }) => Effect.Effect<
      ReadonlyArray<InboxEvent>,
      CompanionInvalidRequestError | CompanionStoreError
    >;
    /** The caller's subscribed threads with draft pull requests whose checks pass. */
    readonly openWork: (
      subscriber: ThreadRefInput,
    ) => Effect.Effect<
      ReadonlyArray<OpenWorkItem>,
      CompanionInvalidRequestError | CompanionStoreError
    >;
    readonly relevance: (
      environment: string,
      threadId: string,
      projectId: string,
    ) => Effect.Effect<Relevance>;
    /** Records a thread's latest shell row; a subscriber's turn end releases its low digests. */
    readonly observe: (
      environment: string,
      shell: OrchestrationV2ThreadShell,
    ) => Effect.Effect<void, CompanionStoreError>;
    readonly publish: (event: ThreadEvent) => Effect.Effect<void, CompanionStoreError>;
    /** Compares a source's linked PRs' checks with the last seen state; finished checks publish. */
    readonly trackChecks: (
      environment: string,
      shell: OrchestrationV2ThreadShell,
    ) => Effect.Effect<void, CompanionStoreError>;
    /** Subscribes follow subscribers to a new thread they launched; checked once per thread. */
    readonly discover: (
      environment: string,
      shell: OrchestrationV2ThreadShell,
    ) => Effect.Effect<void, CompanionInvalidRequestError | CompanionStoreError>;
    /** Sends digests that a previous run recorded but never announced. */
    readonly flushPendingWakes: Effect.Effect<void, CompanionStoreError>;
    /** Brings back snoozed items whose time passed while their source is idle; runs forever. */
    readonly runSnoozes: Effect.Effect<never>;
  }
>()("t3cli/companion/CompanionHub") {}

const refKey = (ref: ThreadRef) => `${ref.environment}/${ref.threadId}`;

const matches = (subscription: Subscription, event: ThreadEvent) =>
  subscription.source.environment === event.environment &&
  (event.threadId === null
    ? environmentEventKinds.includes(event.kind)
    : matchesThread(subscription, event));

const matchesThread = (subscription: Subscription, event: ThreadEvent) =>
  // A follow subscription only creates thread subscriptions; it takes no events itself.
  !subscription.follow &&
  (subscription.source.threadId === null
    ? subscription.source.projectId === event.projectId
    : subscription.source.threadId === event.threadId) &&
  subscription.events.includes(event.kind) &&
  // A thread never wakes itself.
  !(
    subscription.subscriber.environment === event.environment &&
    subscription.subscriber.threadId === event.threadId
  );

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

const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

/** The events a thread's current state already implies, for a subscription made just now. */
const currentEvents = (environment: string, shell: OrchestrationV2ThreadShell, nowMs: number) => {
  const events = immediateEvents(environment, shell).filter((event) => event.kind !== "settled");
  const idle = idleCandidate(environment, shell, nowMs);
  return idle !== null && idle.notBeforeMs <= nowMs ? [...events, idle.event] : events;
};

export const makeCompanionHub = Effect.fn("makeCompanionHub")(function* () {
  const store = yield* CompanionStore;
  const environments = yield* CompanionEnvironments;
  const subscriptions = yield* Ref.make(yield* store.listSubscriptions(null));
  const threads = yield* Ref.make(
    new Map<string, { readonly environment: string; readonly shell: OrchestrationV2ThreadShell }>(),
  );
  const delivered = yield* PubSub.unbounded<InboxEvent>();
  const wakes = yield* FiberMap.make<string>();

  const normalizeRef = Effect.fn("CompanionHub.normalizeRef")(function* (ref: ThreadRefInput) {
    const environment = yield* environments
      .resolve(ref.environment)
      .pipe(
        Effect.mapError((error) => new CompanionInvalidRequestError({ message: error.message })),
      );
    if (ref.threadId.length === 0) {
      return yield* new CompanionInvalidRequestError({ message: "thread id must not be empty" });
    }
    return { environment: environment.name, threadId: ref.threadId };
  });

  const refreshSubscriptions = store
    .listSubscriptions(null)
    .pipe(Effect.flatMap((all) => Ref.set(subscriptions, all)));

  const statusOf = Effect.fn("CompanionHub.statusOf")(function* (ref: ThreadRef) {
    const entry = (yield* Ref.get(threads)).get(refKey(ref));
    if (entry === undefined) {
      return null;
    }
    return threadStatus(entry.environment, entry.shell, yield* Clock.currentTimeMillis);
  });

  /**
   * Whether a subscriber is in a turn. Unlike a source's state, its own background work does not
   * count: an orchestrator usually has delegates running between turns and must still be woken.
   */
  const inTurn = Effect.fn("CompanionHub.inTurn")(function* (ref: ThreadRef) {
    const entry = (yield* Ref.get(threads)).get(refKey(ref));
    return (
      entry !== undefined && busyReasons(entry.shell, yield* Clock.currentTimeMillis).length > 0
    );
  });

  /** Fills in the source thread's last assistant message; the shell row carries no text. */
  const withLastMessage = Effect.fn("CompanionHub.withLastMessage")(function* (event: ThreadEvent) {
    if (event.threadId === null || !["idle", "failed", "settled"].includes(event.kind)) {
      return event;
    }
    const threadId = event.threadId;
    const lastMessage = yield* environments.resolve(event.environment).pipe(
      Effect.flatMap((environment) => environment.orchestration.getThreadBoundedSnapshot(threadId)),
      Effect.map((snapshot) => {
        const message = snapshot.projection.turnItems.findLast(
          (item) => item.type === "assistant_message",
        );
        return message !== undefined && "text" in message
          ? message.text.slice(0, lastMessageLength)
          : null;
      }),
      Effect.catchCause((cause) =>
        Effect.logWarning(`could not read the last message of ${event.eventId}`, cause).pipe(
          Effect.as(null),
        ),
      ),
    );
    return { ...event, lastMessage };
  });

  /**
   * Re-checks each item against its source's latest shell row: an idle or settled the source
   * moved past (a newer run) is resolved as superseded, and PR states are brought up to date.
   */
  const freshen = Effect.fn("CompanionHub.freshen")(function* (rows: ReadonlyArray<InboxEvent>) {
    const current = yield* Ref.get(threads);
    const kept: Array<InboxEvent> = [];
    for (const row of rows) {
      const event = row.event;
      const latest =
        event.threadId === null
          ? undefined
          : current.get(refKey({ environment: event.environment, threadId: event.threadId }));
      if (latest === undefined) {
        kept.push(row);
        continue;
      }
      const runId = event.runId ?? null;
      if (
        (event.kind === "idle" || event.kind === "settled") &&
        runId !== null &&
        latest.shell.latestRunId !== runId
      ) {
        yield* store.resolve({
          subscriber: row.subscriber,
          ids: [row.id],
          disposition: "auto: superseded, the source started a new run",
        });
        continue;
      }
      const now = pullRequestSummaries(latest.shell);
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

  const sendDigest = Effect.fn("CompanionHub.sendDigest")(function* (subscriber: ThreadRef) {
    const pending = (yield* freshen(
      (yield* store.pendingWakes()).filter((row) => refKey(row.subscriber) === refKey(subscriber)),
    )).toSorted((a, b) =>
      a.priority === b.priority ? a.id - b.id : priorityRank[a.priority] - priorityRank[b.priority],
    );
    const first = pending[0];
    if (first === undefined) {
      return false;
    }
    // The companion holds the batch itself while the subscriber works, rather than piling one
    // T3 Code queued turn per event behind it: only urgent items steer into a running turn,
    // carrying everything else pending; the rest go out as one new turn once it ends.
    const busy = yield* inTurn(subscriber);
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
              `agent-marked digest to ${refKey(subscriber)} failed; sending it as a plain message`,
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
      `sent ${first.priority} digest to ${refKey(subscriber)} for inbox ${pending.map((row) => row.id).join(", ")}`,
    );
    return true;
  });

  // One digest per window: events that land while a digest is pending join it, and events
  // that land during the send start the next window.
  const scheduleWake = (subscriber: ThreadRef) =>
    FiberMap.run(
      wakes,
      refKey(subscriber),
      Effect.gen(function* () {
        let sent = true;
        while (sent) {
          yield* Effect.sleep(wakeCoalesceWindow);
          sent = yield* sendDigest(subscriber);
        }
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning(`wake digest to ${refKey(subscriber)} failed; it stays pending`, cause),
        ),
      ),
      { onlyIfMissing: true },
    );

  const deliverTo = Effect.fn("CompanionHub.deliverTo")(function* (
    subscription: Subscription,
    event: ThreadEvent,
  ) {
    const row = yield* store.deliver(subscription, event, deliveryPriority(subscription, event));
    if (row === null) {
      return;
    }
    if (event.kind === "settled" && event.threadId !== null) {
      const sourceThreadId = event.threadId;
      const prsDone = event.pullRequests.every((pr) => pr.state !== "open");
      const messageSeen =
        event.lastMessage === null ||
        (yield* store.hasDeliveredMessage({
          subscriber: subscription.subscriber,
          threadId: sourceThreadId,
          message: event.lastMessage,
          exceptEventId: event.eventId,
        }));
      if (prsDone && messageSeen) {
        yield* store.resolve({
          subscriber: subscription.subscriber,
          ids: [row.id],
          disposition: "auto: nothing new, PRs done and the last message already delivered",
        });
        yield* Effect.logInfo(`inbox ${row.id}: ${event.eventId} resolved as nothing new`);
        return;
      }
    }
    yield* Effect.logInfo(
      `inbox ${row.id}: ${event.eventId} -> ${refKey(row.subscriber)} (${row.priority})`,
    );
    if (event.kind === "idle" && !event.pause) {
      yield* store.resolveEvent({
        subscriber: subscription.subscriber,
        eventId: `${event.eventId}/pause`,
        disposition: "auto: superseded, the run's background work finished",
      });
    }
    yield* PubSub.publish(delivered, row);
    if (subscription.wake) {
      yield* scheduleWake(subscription.subscriber);
    }
  });

  const publish = Effect.fn("CompanionHub.publish")(function* (event: ThreadEvent) {
    // Subscribing does not replay state that already held before the subscription existed.
    const matching = (yield* Ref.get(subscriptions)).filter(
      (subscription) => matches(subscription, event) && event.occurredAt >= subscription.createdAt,
    );
    if (matching.length === 0) {
      return;
    }
    // Snapshot replays repeat events; skip the message read when every inbox already has it.
    const already = new Set((yield* store.deliveredTo(event.eventId)).map(refKey));
    const targets = matching.filter(
      (subscription) => !already.has(refKey(subscription.subscriber)),
    );
    if (targets.length === 0) {
      return;
    }
    const enriched = yield* withLastMessage(event);
    for (const subscription of targets) {
      yield* deliverTo(subscription, enriched);
    }
  });

  const subscribe = Effect.fn("CompanionHub.subscribe")(function* (input: SubscribeInput) {
    const subscriber = yield* normalizeRef(input.subscriber);
    const hasThread = input.source.threadId !== undefined && input.source.threadId.length > 0;
    const hasProject = input.source.projectId !== undefined && input.source.projectId.length > 0;
    if (hasThread === hasProject) {
      return yield* new CompanionInvalidRequestError({
        message: "subscribe to exactly one of a source thread or a source project",
      });
    }
    if (input.events.length === 0) {
      return yield* new CompanionInvalidRequestError({ message: "events must not be empty" });
    }
    const follow = input.follow === true;
    if (follow && !hasProject) {
      return yield* new CompanionInvalidRequestError({
        message: "follow needs a project source: it follows your new threads in that project",
      });
    }
    const sourceEnvironment = yield* environments
      .resolve(input.source.environment)
      .pipe(
        Effect.mapError((error) => new CompanionInvalidRequestError({ message: error.message })),
      );
    const source: SubscriptionSource = {
      environment: sourceEnvironment.name,
      threadId: hasThread ? (input.source.threadId ?? null) : null,
      projectId: hasProject ? (input.source.projectId ?? null) : null,
    };
    const subscription = yield* store.addSubscription({
      subscriber,
      source,
      events: input.events,
      wake: input.wake,
      priorities: input.priorities,
      follow,
    });
    yield* refreshSubscriptions;
    if (source.threadId === null) {
      return { subscription, source: null } satisfies SubscribeResult;
    }

    // A thread can fail, ask, or finish before the subscription exists; report where it is now.
    const sourceThreadId = source.threadId;
    const shell = yield* sourceEnvironment.orchestration.getShellSnapshot().pipe(
      Effect.map((snapshot) =>
        Option.fromNullishOr(snapshot.threads.find((thread) => thread.id === sourceThreadId)),
      ),
      Effect.catchCause((cause) =>
        Effect.logWarning(`could not read the state of ${sourceThreadId}`, cause).pipe(
          Effect.as(Option.none<OrchestrationV2ThreadShell>()),
        ),
      ),
    );
    if (Option.isNone(shell)) {
      return { subscription, source: null } satisfies SubscribeResult;
    }
    yield* observe(sourceEnvironment.name, shell.value);
    const nowMs = yield* Clock.currentTimeMillis;
    for (const event of currentEvents(sourceEnvironment.name, shell.value, nowMs)) {
      if (matches(subscription, event)) {
        yield* deliverTo(subscription, yield* withLastMessage(event));
      }
    }
    return {
      subscription,
      source: threadStatus(sourceEnvironment.name, shell.value, nowMs),
    } satisfies SubscribeResult;
  });

  const unsubscribe = Effect.fn("CompanionHub.unsubscribe")(function* (input: {
    readonly subscriber: ThreadRefInput;
    readonly ids: ReadonlyArray<number>;
  }) {
    const subscriber = yield* normalizeRef(input.subscriber);
    const removed = yield* store.removeSubscriptions({ subscriber, ids: input.ids });
    yield* refreshSubscriptions;
    return removed;
  });

  const listSubscriptions = Effect.fn("CompanionHub.listSubscriptions")(function* (
    ref: ThreadRefInput,
  ) {
    return yield* store.listSubscriptions(yield* normalizeRef(ref));
  });

  const listInbox = Effect.fn("CompanionHub.listInbox")(function* (input: {
    readonly subscriber: ThreadRefInput;
    readonly includeResolved: boolean;
    readonly afterId: number;
    readonly limit: number;
  }) {
    return yield* store.listInbox({ ...input, subscriber: yield* normalizeRef(input.subscriber) });
  });

  const resolve = Effect.fn("CompanionHub.resolve")(function* (input: {
    readonly subscriber: ThreadRefInput;
    readonly ids: ReadonlyArray<number>;
    readonly disposition: string | null;
  }) {
    return yield* store.resolve({ ...input, subscriber: yield* normalizeRef(input.subscriber) });
  });

  const snooze = Effect.fn("CompanionHub.snooze")(function* (input: {
    readonly subscriber: ThreadRefInput;
    readonly ids: ReadonlyArray<number>;
    readonly minSeconds: number;
  }) {
    const subscriber = yield* normalizeRef(input.subscriber);
    if (!(input.minSeconds >= 0)) {
      return yield* new CompanionInvalidRequestError({ message: "minSeconds must be at least 0" });
    }
    const until = DateTime.formatIso(
      DateTime.addDuration(yield* DateTime.now, Duration.seconds(input.minSeconds)),
    );
    return yield* store.snooze({ subscriber, ids: input.ids, until });
  });

  const redeliverDue = Effect.fn("CompanionHub.redeliverDue")(function* () {
    for (const row of yield* store.dueSnoozes(yield* nowIso)) {
      const source =
        row.event.threadId === null
          ? null
          : yield* statusOf({ environment: row.event.environment, threadId: row.event.threadId });
      // A snooze waits for the source to stop working, not only for the time to pass.
      if (source !== null && source.state === "running") {
        continue;
      }
      const back = yield* store.redeliver(row.id);
      if (back === null) {
        continue;
      }
      yield* Effect.logInfo(`inbox ${back.id}: snooze over -> ${refKey(back.subscriber)}`);
      yield* PubSub.publish(delivered, back);
      const subscription = (yield* Ref.get(subscriptions)).find(
        (candidate) => candidate.id === back.subscriptionId,
      );
      if (subscription?.wake === true) {
        yield* scheduleWake(back.subscriber);
      }
    }
  });

  const observe = Effect.fn("CompanionHub.observe")(function* (
    environment: string,
    shell: OrchestrationV2ThreadShell,
  ) {
    const ref = { environment, threadId: shell.id };
    const wasBusy = yield* inTurn(ref);
    yield* Ref.update(threads, (current) =>
      new Map(current).set(refKey(ref), { environment, shell }),
    );
    const nowBusy = yield* inTurn(ref);
    if (!wasBusy || nowBusy) {
      return;
    }
    // A turn ended: release this subscriber's waiting digests and its sources' snoozes.
    if ((yield* store.pendingWakes()).some((row) => refKey(row.subscriber) === refKey(ref))) {
      yield* scheduleWake(ref);
    }
    yield* redeliverDue();
  });

  const relevance = (environment: string, threadId: string, projectId: string) =>
    Ref.get(subscriptions).pipe(
      Effect.map((all) => ({
        source: all.some(
          (subscription) =>
            !subscription.follow &&
            subscription.source.environment === environment &&
            (subscription.source.threadId === null
              ? subscription.source.projectId === projectId
              : subscription.source.threadId === threadId),
        ),
        subscriber: all.some(
          (subscription) =>
            subscription.subscriber.environment === environment &&
            subscription.subscriber.threadId === threadId,
        ),
      })),
    );

  const wait = Effect.fn("CompanionHub.wait")(function* (input: {
    readonly subscriber: ThreadRefInput;
    readonly afterId: number;
    readonly kinds: ReadonlyArray<CompanionEventKind>;
    readonly timeout: Duration.Duration;
  }) {
    const subscriber = yield* normalizeRef(input.subscriber);
    const wanted = (row: InboxEvent) =>
      refKey(row.subscriber) === refKey(subscriber) &&
      row.id > input.afterId &&
      row.resolvedAt === null &&
      row.snoozedUntil === null &&
      (input.kinds.length === 0 || input.kinds.includes(row.event.kind));
    // Subscribe before reading the store so a row delivered in between is not missed.
    const live = yield* PubSub.subscribe(delivered);
    const existing = (yield* store.listInbox({
      subscriber,
      includeResolved: false,
      afterId: input.afterId,
      limit: 100,
    })).filter(wanted);
    if (existing.length > 0) {
      return existing;
    }
    const next = yield* Effect.gen(function* () {
      while (true) {
        const row = yield* PubSub.take(live);
        if (wanted(row)) {
          return [row];
        }
      }
    }).pipe(Effect.timeoutOption(input.timeout));
    return Option.getOrElse(next, () => []);
  }, Effect.scoped);

  const openWork = Effect.fn("CompanionHub.openWork")(function* (ref: ThreadRefInput) {
    const subscriber = yield* normalizeRef(ref);
    const sources = new Map<string, ThreadRef>();
    for (const subscription of yield* store.listSubscriptions(subscriber)) {
      if (subscription.source.threadId !== null) {
        const source = {
          environment: subscription.source.environment,
          threadId: subscription.source.threadId,
        };
        sources.set(refKey(source), source);
      }
    }
    const items: Array<OpenWorkItem> = [];
    for (const source of sources.values()) {
      const status = yield* statusOf(source);
      if (status === null) {
        continue;
      }
      const ready = readyToMark(status.pullRequests);
      if (ready.length > 0) {
        items.push({
          environment: status.environment,
          threadId: status.threadId,
          title: status.title,
          state: status.state,
          readyToMark: ready,
        });
      }
    }
    return items;
  });

  const trackChecks = Effect.fn("CompanionHub.trackChecks")(function* (
    environment: string,
    shell: OrchestrationV2ThreadShell,
  ) {
    if ((shell.pullRequests ?? []).length === 0) {
      return;
    }
    const previous = yield* store.loadChecks(environment, shell.id);
    const transitions = checksTransitions(environment, shell, previous, yield* nowIso);
    yield* store.saveChecks(
      environment,
      shell.id,
      transitions.map((transition) => transition.record),
    );
    for (const transition of transitions) {
      if (transition.event !== null) {
        yield* publish(transition.event);
      }
    }
  });

  // Threads already checked against follow subscriptions, by subscription and thread.
  const followChecked = new Set<string>();

  const discover = Effect.fn("CompanionHub.discover")(function* (
    environment: string,
    shell: OrchestrationV2ThreadShell,
  ) {
    const createdAt = DateTime.formatIso(shell.createdAt);
    const all = yield* Ref.get(subscriptions);
    const follows = all.filter(
      (subscription) =>
        subscription.follow &&
        subscription.source.environment === environment &&
        subscription.source.projectId === shell.projectId &&
        subscription.subscriber.threadId !== shell.id &&
        createdAt >= subscription.createdAt &&
        !followChecked.has(`${subscription.id}/${shell.id}`),
    );
    if (follows.length === 0) {
      return;
    }
    // T3 Code stamps the launching thread on the new thread's first message, not on the thread.
    const sender = yield* environments.resolve(environment).pipe(
      Effect.flatMap((env) => env.orchestration.getThreadBoundedSnapshot(shell.id)),
      Effect.map((snapshot) => {
        const first = snapshot.projection.turnItems.find((item) => item.type === "user_message");
        return first === undefined
          ? undefined
          : "senderThreadId" in first
            ? (first.senderThreadId ?? null)
            : null;
      }),
      Effect.catchCause((cause) =>
        Effect.logWarning(`could not read who launched ${shell.id}`, cause).pipe(
          Effect.as(undefined),
        ),
      ),
    );
    // No first message yet: look again on the thread's next update.
    if (sender === undefined) {
      return;
    }
    for (const follow of follows) {
      followChecked.add(`${follow.id}/${shell.id}`);
      const already = all.some(
        (subscription) =>
          refKey(subscription.subscriber) === refKey(follow.subscriber) &&
          subscription.source.environment === environment &&
          subscription.source.threadId === shell.id,
      );
      if (sender !== follow.subscriber.threadId || already) {
        continue;
      }
      yield* Effect.logInfo(
        `following ${environment}/${shell.id} for ${refKey(follow.subscriber)}`,
      );
      yield* subscribe({
        subscriber: follow.subscriber,
        source: { environment, threadId: shell.id },
        events: follow.events,
        wake: follow.wake,
        priorities: follow.priorities,
      });
    }
  });

  const flushPendingWakes = Effect.gen(function* () {
    const pending = yield* store.pendingWakes();
    const subscribers = new Map(pending.map((row) => [refKey(row.subscriber), row.subscriber]));
    for (const subscriber of subscribers.values()) {
      yield* scheduleWake(subscriber);
    }
  });

  const runSnoozes = redeliverDue().pipe(
    Effect.catchCause((cause) => Effect.logWarning("snooze check failed", cause)),
    Effect.repeat(Schedule.spaced(snoozeCheckInterval)),
    Effect.andThen(Effect.never),
  );

  return CompanionHub.of({
    normalizeRef,
    subscribe,
    unsubscribe,
    listSubscriptions,
    listInbox,
    resolve,
    snooze,
    wait,
    openWork,
    relevance,
    observe,
    publish,
    trackChecks,
    discover,
    flushPendingWakes,
    runSnoozes,
  });
});

export const CompanionHubLive = Layer.effect(CompanionHub, makeCompanionHub());
