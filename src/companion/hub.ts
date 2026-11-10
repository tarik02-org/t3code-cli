import type { OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";

import { deliveryPriority, itemWakes, relevance, subscriptionTakes } from "./delivery.ts";
import { makeDigests } from "./digest.ts";
import { CompanionEnvironments } from "./environments.ts";
import { CompanionInvalidRequestError, type CompanionStoreError } from "./error.ts";
import {
  threadRefKey,
  type InboxEvent,
  type InboxListRequest,
  type OpenWorkItem,
  type ResolveRequest,
  type SelectionRequest,
  type SnoozeRequest,
  type SubscribeRequest,
  type SubscribeResult,
  type SubscriberRequest,
  type Subscription,
  type SubscriptionSource,
  type ThreadEvent,
  type ThreadRef,
  type ThreadRefInput,
  type WaitRequest,
} from "./schema.ts";
import {
  checksTransitions,
  currentEvents,
  holdsSnooze,
  idleCandidate,
  immediateEvents,
  inTurn,
  readyToMark,
  threadStatus,
} from "./state.ts";
import { CompanionStore } from "./store.ts";

export const maxWaitSeconds = 600;
/** How often snoozed items are checked for their time having passed. */
export const snoozeCheckInterval = Duration.seconds(15);
/** The longest last message an event carries; digests include it whole. */
export const lastMessageLength = 10_000;

type RequestError = CompanionInvalidRequestError | CompanionStoreError;

export class CompanionHub extends Context.Service<
  CompanionHub,
  {
    readonly subscribe: (input: SubscribeRequest) => Effect.Effect<SubscribeResult, RequestError>;
    /** Arms the caller's subscriptions so the next event from each wakes it once. */
    readonly arm: (input: SelectionRequest) => Effect.Effect<number, RequestError>;
    readonly unsubscribe: (input: SelectionRequest) => Effect.Effect<number, RequestError>;
    readonly listSubscriptions: (
      input: SubscriberRequest,
    ) => Effect.Effect<ReadonlyArray<Subscription>, RequestError>;
    readonly listInbox: (
      input: InboxListRequest,
    ) => Effect.Effect<ReadonlyArray<InboxEvent>, RequestError>;
    readonly resolve: (input: ResolveRequest) => Effect.Effect<number, RequestError>;
    readonly snooze: (input: SnoozeRequest) => Effect.Effect<number, RequestError>;
    /** Open items newer than `afterId`; with none, waits for the first until the timeout. */
    readonly wait: (input: WaitRequest) => Effect.Effect<ReadonlyArray<InboxEvent>, RequestError>;
    /** The caller's subscribed threads with draft pull requests whose checks pass. */
    readonly openWork: (
      input: SubscriberRequest,
    ) => Effect.Effect<ReadonlyArray<OpenWorkItem>, RequestError>;
    /**
     * Takes a thread's latest shell row from the watcher: follows a new thread for whoever
     * launched it, records the row, and publishes what a source's row already shows. Returns the
     * idle event to publish once the thread has stayed quiet, or null when it is not idle.
     */
    readonly ingest: (
      environment: string,
      shell: OrchestrationV2ThreadShell,
    ) => Effect.Effect<ThreadEvent | null, RequestError>;
    /** Drops what is remembered about a thread that no longer exists. */
    readonly forget: (environment: string, threadId: string) => Effect.Effect<void>;
    readonly publish: (event: ThreadEvent) => Effect.Effect<void, CompanionStoreError>;
    /** Sends digests that a previous run recorded but never announced. */
    readonly flushPendingWakes: Effect.Effect<void, CompanionStoreError>;
    /** Brings back snoozed items whose time passed while their source is idle; runs forever. */
    readonly runSnoozes: Effect.Effect<never>;
  }
>()("t3cli/companion/CompanionHub") {}

const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

export const makeCompanionHub = Effect.fn("makeCompanionHub")(function* () {
  const store = yield* CompanionStore;
  const environments = yield* CompanionEnvironments;
  const threads = yield* Ref.make(new Map<string, OrchestrationV2ThreadShell>());
  const delivered = yield* PubSub.unbounded<InboxEvent>();

  const latestShell = (ref: ThreadRef) =>
    Ref.get(threads).pipe(Effect.map((all) => all.get(threadRefKey(ref))));
  const digests = yield* makeDigests(latestShell);

  /** Resolves env aliases to the canonical name the store keys on. */
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

  const subscriptionsOf = (subscriber: ThreadRef) =>
    store.subscriptions.pipe(
      Effect.map((all) =>
        all.filter(
          (subscription) => threadRefKey(subscription.subscriber) === threadRefKey(subscriber),
        ),
      ),
    );

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

  const deliverTo = Effect.fn("CompanionHub.deliverTo")(function* (
    subscription: Subscription,
    event: ThreadEvent,
  ) {
    const priority = deliveryPriority(subscription, event);
    const waking = itemWakes(subscription, event, priority);
    const row = yield* store.deliver(subscription, event, priority, !waking);
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
      `inbox ${row.id}: ${event.eventId} -> ${threadRefKey(row.subscriber)} (${row.priority})`,
    );
    if (event.kind === "idle" && !event.pause) {
      yield* store.resolveEvent({
        subscriber: subscription.subscriber,
        eventId: `${event.eventId}/pause`,
        disposition: "auto: superseded, the run's background work finished",
      });
    }
    yield* PubSub.publish(delivered, row);
    if (!waking) {
      return;
    }
    // One wake per arm; failures and questions wake without spending it.
    if (priority !== "urgent") {
      yield* store.setArmed({ ids: [subscription.id], armed: false });
    }
    yield* digests.schedule(subscription.subscriber);
  });

  const publish = Effect.fn("CompanionHub.publish")(function* (event: ThreadEvent) {
    // Subscribing does not replay state that already held before the subscription existed.
    const matching = (yield* store.subscriptions).filter(
      (subscription) =>
        subscriptionTakes(subscription, event) && event.occurredAt >= subscription.createdAt,
    );
    if (matching.length === 0) {
      return;
    }
    // Snapshot replays repeat events; skip the message read when every inbox already has it.
    const already = new Set((yield* store.deliveredTo(event.eventId)).map(threadRefKey));
    const targets = matching.filter(
      (subscription) => !already.has(threadRefKey(subscription.subscriber)),
    );
    if (targets.length === 0) {
      return;
    }
    const enriched = yield* withLastMessage(event);
    for (const subscription of targets) {
      yield* deliverTo(subscription, enriched);
    }
  });

  const redeliverDue = Effect.fn("CompanionHub.redeliverDue")(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    for (const row of yield* store.dueSnoozes(yield* nowIso)) {
      const source =
        row.event.threadId === null
          ? undefined
          : yield* latestShell({
              environment: row.event.environment,
              threadId: row.event.threadId,
            });
      // A snooze waits for the source to stop working, not only for the time to pass.
      if (source !== undefined && holdsSnooze(source, nowMs)) {
        continue;
      }
      const back = yield* store.redeliver(row.id);
      if (back === null) {
        continue;
      }
      yield* Effect.logInfo(`inbox ${back.id}: snooze over -> ${threadRefKey(back.subscriber)}`);
      yield* PubSub.publish(delivered, back);
      const subscription = (yield* store.subscriptions).find(
        (candidate) => candidate.id === back.subscriptionId,
      );
      if (subscription?.wake === true) {
        yield* digests.schedule(back.subscriber);
      }
    }
  });

  /** Records a thread's latest shell row; a subscriber's turn end releases what waited on it. */
  const observe = Effect.fn("CompanionHub.observe")(function* (
    environment: string,
    shell: OrchestrationV2ThreadShell,
  ) {
    const ref = { environment, threadId: shell.id };
    const nowMs = yield* Clock.currentTimeMillis;
    const previous = yield* latestShell(ref);
    yield* Ref.update(threads, (current) => new Map(current).set(threadRefKey(ref), shell));
    if (previous === undefined || !inTurn(previous, nowMs) || inTurn(shell, nowMs)) {
      return;
    }
    // A turn ended: release this subscriber's waiting digests and its sources' snoozes.
    if ((yield* store.pendingDigest(ref)).some((row) => !row.passive)) {
      yield* digests.schedule(ref);
    }
    yield* redeliverDue();
  });

  const subscribe = Effect.fn("CompanionHub.subscribe")(function* (input: SubscribeRequest) {
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
    const subscription = yield* store.upsertSubscription({
      subscriber,
      source,
      events: input.events,
      wake: input.wake,
      priorities: input.priorities,
      follow,
    });
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
      if (subscriptionTakes(subscription, event)) {
        yield* deliverTo(subscription, yield* withLastMessage(event));
      }
    }
    return {
      subscription,
      source: threadStatus(sourceEnvironment.name, shell.value, nowMs),
    } satisfies SubscribeResult;
  });

  const arm = Effect.fn("CompanionHub.arm")(function* (input: SelectionRequest) {
    const subscriber = yield* normalizeRef(input.subscriber);
    return yield* store.setArmed({ subscriber, ids: input.ids, armed: true });
  });

  const unsubscribe = Effect.fn("CompanionHub.unsubscribe")(function* (input: SelectionRequest) {
    const subscriber = yield* normalizeRef(input.subscriber);
    return yield* store.removeSubscriptions({ subscriber, ids: input.ids });
  });

  const listSubscriptions = Effect.fn("CompanionHub.listSubscriptions")(function* (
    input: SubscriberRequest,
  ) {
    return yield* subscriptionsOf(yield* normalizeRef(input.subscriber));
  });

  const listInbox = Effect.fn("CompanionHub.listInbox")(function* (input: InboxListRequest) {
    return yield* store.listInbox({ ...input, subscriber: yield* normalizeRef(input.subscriber) });
  });

  const resolve = Effect.fn("CompanionHub.resolve")(function* (input: ResolveRequest) {
    return yield* store.resolve({ ...input, subscriber: yield* normalizeRef(input.subscriber) });
  });

  const snooze = Effect.fn("CompanionHub.snooze")(function* (input: SnoozeRequest) {
    const subscriber = yield* normalizeRef(input.subscriber);
    if (!(input.minSeconds >= 0)) {
      return yield* new CompanionInvalidRequestError({ message: "minSeconds must be at least 0" });
    }
    const until = DateTime.formatIso(
      DateTime.addDuration(yield* DateTime.now, Duration.seconds(input.minSeconds)),
    );
    return yield* store.snooze({ subscriber, ids: input.ids, until });
  });

  const wait = Effect.fn("CompanionHub.wait")(function* (input: WaitRequest) {
    const subscriber = yield* normalizeRef(input.subscriber);
    const timeout = Duration.seconds(Math.min(Math.max(input.timeoutSeconds, 0), maxWaitSeconds));
    const wanted = (row: InboxEvent) =>
      threadRefKey(row.subscriber) === threadRefKey(subscriber) &&
      row.id > input.afterId &&
      row.resolvedAt === null &&
      row.snoozedUntil === null &&
      (input.events.length === 0 || input.events.includes(row.event.kind));
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
    }).pipe(Effect.timeoutOption(timeout));
    return Option.getOrElse(next, () => []);
  }, Effect.scoped);

  const openWork = Effect.fn("CompanionHub.openWork")(function* (input: SubscriberRequest) {
    const subscriber = yield* normalizeRef(input.subscriber);
    const sources = new Map<string, ThreadRef>();
    for (const subscription of yield* subscriptionsOf(subscriber)) {
      if (subscription.source.threadId !== null) {
        const source = {
          environment: subscription.source.environment,
          threadId: subscription.source.threadId,
        };
        sources.set(threadRefKey(source), source);
      }
    }
    const nowMs = yield* Clock.currentTimeMillis;
    const items: Array<OpenWorkItem> = [];
    for (const source of sources.values()) {
      const shell = yield* latestShell(source);
      if (shell === undefined) {
        continue;
      }
      const status = threadStatus(source.environment, shell, nowMs);
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

  /** Compares a source's linked PRs' checks with the last seen state; finished checks publish. */
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

  // The follow subscriptions each thread was already checked against: who launched a thread
  // never changes, and a subscriber that drops a followed thread must not get it back.
  const followChecked = new Map<string, Set<number>>();

  /** Subscribes follow subscribers to a new thread they launched; checked once per thread. */
  const discover = Effect.fn("CompanionHub.discover")(function* (
    environment: string,
    shell: OrchestrationV2ThreadShell,
  ) {
    const key = threadRefKey({ environment, threadId: shell.id });
    const createdAt = DateTime.formatIso(shell.createdAt);
    const all = yield* store.subscriptions;
    const follows = all.filter(
      (subscription) =>
        subscription.follow &&
        subscription.source.environment === environment &&
        subscription.source.projectId === shell.projectId &&
        subscription.subscriber.threadId !== shell.id &&
        createdAt >= subscription.createdAt &&
        followChecked.get(key)?.has(subscription.id) !== true,
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
    const checked = followChecked.get(key) ?? new Set<number>();
    followChecked.set(key, checked);
    for (const follow of follows) {
      checked.add(follow.id);
      const already = all.some(
        (subscription) =>
          threadRefKey(subscription.subscriber) === threadRefKey(follow.subscriber) &&
          subscription.source.environment === environment &&
          subscription.source.threadId === shell.id,
      );
      if (sender !== follow.subscriber.threadId || already) {
        continue;
      }
      yield* Effect.logInfo(`following ${key} for ${threadRefKey(follow.subscriber)}`);
      yield* subscribe({
        subscriber: follow.subscriber,
        source: { environment, threadId: shell.id },
        events: follow.events,
        wake: follow.wake,
        priorities: follow.priorities,
      });
    }
  });

  const ingest = Effect.fn("CompanionHub.ingest")(function* (
    environment: string,
    shell: OrchestrationV2ThreadShell,
  ) {
    const { source, subscriber } = relevance(
      yield* store.subscriptions,
      environment,
      shell.id,
      shell.projectId,
    );
    yield* discover(environment, shell);
    if (source || subscriber) {
      yield* observe(environment, shell);
    }
    if (!source || shell.deletedAt !== null || shell.archivedAt !== null) {
      return null;
    }
    for (const event of immediateEvents(environment, shell)) {
      yield* publish(event);
    }
    yield* trackChecks(environment, shell);
    return idleCandidate(environment, shell, yield* Clock.currentTimeMillis);
  });

  const forget = Effect.fn("CompanionHub.forget")(function* (
    environment: string,
    threadId: string,
  ) {
    const key = threadRefKey({ environment, threadId });
    followChecked.delete(key);
    yield* Ref.update(threads, (current) => {
      const next = new Map(current);
      next.delete(key);
      return next;
    });
  });

  const flushPendingWakes = store
    .subscribersToWake()
    .pipe(Effect.flatMap(Effect.forEach(digests.schedule, { discard: true })));

  const runSnoozes = redeliverDue().pipe(
    Effect.catchCause((cause) => Effect.logWarning("snooze check failed", cause)),
    Effect.repeat(Schedule.spaced(snoozeCheckInterval)),
    Effect.andThen(Effect.never),
  );

  return CompanionHub.of({
    subscribe,
    arm,
    unsubscribe,
    listSubscriptions,
    listInbox,
    resolve,
    snooze,
    wait,
    openWork,
    ingest,
    forget,
    publish,
    flushPendingWakes,
    runSnoozes,
  });
});

export const CompanionHubLive = Layer.effect(CompanionHub, makeCompanionHub());
