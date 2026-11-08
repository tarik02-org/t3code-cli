import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";

import { CompanionEnvironments } from "./environments.ts";
import { CompanionInvalidRequestError } from "./error.ts";
import type {
  CompanionEventKind,
  InboxEvent,
  Subscription,
  SubscriptionSource,
  ThreadEvent,
  ThreadRef,
} from "./schema.ts";
import { CompanionStore } from "./store.ts";

export const wakeCoalesceWindow = Duration.seconds(5);
export const maxWaitSeconds = 600;

export interface SubscribeInput {
  readonly subscriber: { readonly environment?: string | undefined; readonly threadId: string };
  readonly source: {
    readonly environment?: string | undefined;
    readonly threadId?: string | undefined;
    readonly projectId?: string | undefined;
  };
  readonly events: ReadonlyArray<CompanionEventKind>;
  readonly wake: boolean;
}

export interface WaitInput {
  readonly subscriber: ThreadRef;
  readonly afterId: number;
  readonly kinds: ReadonlyArray<CompanionEventKind>;
  readonly timeout: Duration.Duration;
}

export class CompanionHub extends Context.Service<
  CompanionHub,
  {
    /** Resolves env aliases to the canonical name the store keys on. */
    readonly normalizeRef: (ref: {
      readonly environment?: string | undefined;
      readonly threadId: string;
    }) => Effect.Effect<ThreadRef, CompanionInvalidRequestError>;
    readonly subscribe: (
      input: SubscribeInput,
    ) => Effect.Effect<Subscription, CompanionInvalidRequestError | CompanionStoreFailure>;
    readonly unsubscribe: (input: {
      readonly subscriber: ThreadRef;
      readonly ids: ReadonlyArray<number>;
    }) => Effect.Effect<number, CompanionStoreFailure>;
    readonly subscriptions: Effect.Effect<ReadonlyArray<Subscription>>;
    /** True when some subscription wants events from this thread. */
    readonly isWatched: (
      environment: string,
      threadId: string,
      projectId: string,
    ) => Effect.Effect<boolean>;
    readonly publish: (event: ThreadEvent) => Effect.Effect<void, CompanionStoreFailure>;
    readonly wait: (
      input: WaitInput,
    ) => Effect.Effect<ReadonlyArray<InboxEvent>, CompanionStoreFailure>;
    /** Sends digests that a previous run recorded but never announced. */
    readonly flushPendingWakes: Effect.Effect<void, CompanionStoreFailure>;
  }
>()("t3cli/companion/CompanionHub") {}

type CompanionStoreFailure = Effect.Error<
  ReturnType<CompanionStore["Service"]["listSubscriptions"]>
>;

const refKey = (ref: ThreadRef) => `${ref.environment}/${ref.threadId}`;

const matches = (subscription: Subscription, event: ThreadEvent) =>
  subscription.source.environment === event.environment &&
  (subscription.source.threadId === null
    ? subscription.source.projectId === event.projectId
    : subscription.source.threadId === event.threadId) &&
  subscription.events.includes(event.kind) &&
  // Subscribing does not replay state that already held before the subscription existed.
  event.occurredAt >= subscription.createdAt &&
  // A thread never wakes itself.
  !(
    subscription.subscriber.environment === event.environment &&
    subscription.subscriber.threadId === event.threadId
  );

function formatDigest(events: ReadonlyArray<InboxEvent>): string {
  const lines = events.map(
    (row) =>
      `- [${row.id}] ${row.event.kind}: "${row.event.title}" (${row.event.environment}/${row.event.threadId}) ${row.event.summary}`,
  );
  return [
    `t3 companion: ${events.length} subscribed thread event${events.length === 1 ? "" : "s"}.`,
    ...lines,
    "Read them with the companion's inbox_list tool and acknowledge them with inbox_ack.",
  ].join("\n");
}

export const makeCompanionHub = Effect.fn("makeCompanionHub")(function* () {
  const store = yield* CompanionStore;
  const environments = yield* CompanionEnvironments;
  const cache = yield* Ref.make(yield* store.listSubscriptions(null));
  const delivered = yield* PubSub.unbounded<InboxEvent>();
  const wakes = yield* FiberMap.make<string>();

  const normalizeRef = Effect.fn("CompanionHub.normalizeRef")(function* (ref: {
    readonly environment?: string | undefined;
    readonly threadId: string;
  }) {
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

  const refreshCache = store
    .listSubscriptions(null)
    .pipe(Effect.flatMap((all) => Ref.set(cache, all)));

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
    });
    yield* refreshCache;
    return subscription;
  });

  const unsubscribe = Effect.fn("CompanionHub.unsubscribe")(function* (input: {
    readonly subscriber: ThreadRef;
    readonly ids: ReadonlyArray<number>;
  }) {
    const removed = yield* store.removeSubscriptions(input);
    yield* refreshCache;
    return removed;
  });

  const isWatched = (environment: string, threadId: string, projectId: string) =>
    Ref.get(cache).pipe(
      Effect.map((all) =>
        all.some(
          (subscription) =>
            subscription.source.environment === environment &&
            (subscription.source.threadId === null
              ? subscription.source.projectId === projectId
              : subscription.source.threadId === threadId),
        ),
      ),
    );

  const sendDigest = Effect.fn("CompanionHub.sendDigest")(function* (subscriber: ThreadRef) {
    const pending = (yield* store.pendingWakes()).filter(
      (row) => refKey(row.subscriber) === refKey(subscriber),
    );
    if (pending.length === 0) {
      return false;
    }
    const environment = yield* environments.resolve(subscriber.environment);
    yield* environment.application.sendThread({
      threadId: subscriber.threadId,
      message: formatDigest(pending),
      mode: "queue",
      author: { kind: "agent" },
    });
    yield* store.markWoken(pending.map((row) => row.id));
    yield* Effect.logInfo(
      `sent wake digest to ${refKey(subscriber)} for inbox ${pending.map((row) => row.id).join(", ")}`,
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

  const publish = Effect.fn("CompanionHub.publish")(function* (event: ThreadEvent) {
    const targets = (yield* Ref.get(cache)).filter((subscription) => matches(subscription, event));
    for (const subscription of targets) {
      const row = yield* store.deliver(subscription, event);
      if (row === null) {
        continue;
      }
      yield* Effect.logInfo(`inbox ${row.id}: ${event.eventId} -> ${refKey(row.subscriber)}`);
      yield* PubSub.publish(delivered, row);
      if (subscription.wake) {
        yield* scheduleWake(subscription.subscriber);
      }
    }
  });

  const wait = Effect.fn("CompanionHub.wait")(function* (input: WaitInput) {
    const wanted = (row: InboxEvent) =>
      refKey(row.subscriber) === refKey(input.subscriber) &&
      row.id > input.afterId &&
      row.ackedAt === null &&
      (input.kinds.length === 0 || input.kinds.includes(row.event.kind));
    // Subscribe before reading the store so a row delivered in between is not missed.
    const live = yield* PubSub.subscribe(delivered);
    const existing = (yield* store.listInbox({
      subscriber: input.subscriber,
      includeAcked: false,
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

  const flushPendingWakes = Effect.gen(function* () {
    const pending = yield* store.pendingWakes();
    const subscribers = new Map(pending.map((row) => [refKey(row.subscriber), row.subscriber]));
    for (const subscriber of subscribers.values()) {
      yield* scheduleWake(subscriber);
    }
  });

  return CompanionHub.of({
    normalizeRef,
    subscribe,
    unsubscribe,
    subscriptions: Ref.get(cache),
    isWatched,
    publish,
    wait,
    flushPendingWakes,
  });
});

export const CompanionHubLive = Layer.effect(CompanionHub, makeCompanionHub());
