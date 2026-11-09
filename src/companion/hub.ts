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
  deliveryPriority,
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
const lastMessageLength = 1500;
const digestMessageLength = 400;

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
    const excerpt = event.lastMessage.slice(0, digestMessageLength).replace(/\s+/g, " ");
    lines.push(
      `    last message: ${excerpt}${event.lastMessage.length > digestMessageLength ? "…" : ""}`,
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

  const isBusy = (ref: ThreadRef) =>
    statusOf(ref).pipe(Effect.map((status) => status !== null && status.state === "running"));

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

  const sendDigest = Effect.fn("CompanionHub.sendDigest")(function* (subscriber: ThreadRef) {
    const pending = (yield* store.pendingWakes())
      .filter((row) => refKey(row.subscriber) === refKey(subscriber))
      .toSorted((a, b) =>
        a.priority === b.priority
          ? a.id - b.id
          : priorityRank[a.priority] - priorityRank[b.priority],
      );
    const first = pending[0];
    if (first === undefined) {
      return false;
    }
    // The companion holds the batch itself while the subscriber works, rather than piling one
    // T3 Code queued turn per event behind it: only urgent items steer into a running turn,
    // carrying everything else pending; the rest go out as one new turn once it ends.
    const busy = yield* isBusy(subscriber);
    if (busy && first.priority !== "urgent") {
      return false;
    }
    const environment = yield* environments.resolve(subscriber.environment);
    yield* environment.application.sendThread({
      threadId: subscriber.threadId,
      message: formatDigest(pending),
      mode: first.priority === "urgent" ? "steer" : "auto",
      author: { kind: "agent" },
    });
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
    yield* Effect.logInfo(
      `inbox ${row.id}: ${event.eventId} -> ${refKey(row.subscriber)} (${row.priority})`,
    );
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
    const wasBusy = yield* isBusy(ref);
    yield* Ref.update(threads, (current) =>
      new Map(current).set(refKey(ref), { environment, shell }),
    );
    const nowBusy = yield* isBusy(ref);
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
    flushPendingWakes,
    runSnoozes,
  });
});

export const CompanionHubLive = Layer.effect(CompanionHub, makeCompanionHub());
