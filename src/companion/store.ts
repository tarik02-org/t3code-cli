import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";

import { CompanionStoreError } from "./error.ts";
import type { ChecksRecord } from "./state.ts";
import {
  CompanionEventKind,
  DeliveryPriority,
  type InboxEvent,
  type Subscription,
  type SubscriptionSource,
  ThreadEvent,
  type ThreadRef,
} from "./schema.ts";

const Priorities = Schema.Record(Schema.String, DeliveryPriority);

const SubscriptionRow = Schema.Struct({
  id: Schema.Number,
  subscriber_env: Schema.String,
  subscriber_thread: Schema.String,
  source_env: Schema.String,
  source_thread: Schema.NullOr(Schema.String),
  source_project: Schema.NullOr(Schema.String),
  events: Schema.fromJsonString(Schema.Array(CompanionEventKind)),
  wake: Schema.Number,
  priorities: Schema.fromJsonString(Priorities),
  follow: Schema.Number,
  armed: Schema.Number,
  created_at: Schema.String,
});
const decodeSubscriptionRows = Schema.decodeUnknownEffect(Schema.Array(SubscriptionRow));

const InboxRow = Schema.Struct({
  id: Schema.Number,
  subscription_id: Schema.Number,
  subscriber_env: Schema.String,
  subscriber_thread: Schema.String,
  event: Schema.fromJsonString(ThreadEvent),
  priority: DeliveryPriority,
  passive: Schema.Number,
  delivered_at: Schema.String,
  snoozed_until: Schema.NullOr(Schema.String),
  redelivered: Schema.Number,
  resolved_at: Schema.NullOr(Schema.String),
  disposition: Schema.NullOr(Schema.String),
});
const decodeInboxRows = Schema.decodeUnknownEffect(Schema.Array(InboxRow));

const ChecksRow = Schema.Struct({
  pr_key: Schema.String,
  head: Schema.NullOr(Schema.String),
  state: Schema.NullOr(Schema.Literals(["pass", "pending", "fail"])),
  cycle: Schema.String,
});
const decodeChecksRows = Schema.decodeUnknownEffect(Schema.Array(ChecksRow));

const encodeEvents = Schema.encodeEffect(Schema.fromJsonString(Schema.Array(CompanionEventKind)));
const encodePriorities = Schema.encodeEffect(Schema.fromJsonString(Priorities));
const encodeEvent = Schema.encodeEffect(Schema.fromJsonString(ThreadEvent));

/** Inbox schema version, kept in `PRAGMA user_version`. */
const schemaVersion = 7;
/** The oldest inbox this build upgrades; earlier layouts were never released. */
const oldestUpgradableVersion = 4;

export interface SubscriptionInput {
  readonly subscriber: ThreadRef;
  readonly source: SubscriptionSource;
  readonly events: ReadonlyArray<CompanionEventKind>;
  readonly wake: boolean;
  readonly priorities: Readonly<Record<string, DeliveryPriority>>;
  readonly follow: boolean;
}

export interface InboxQuery {
  readonly subscriber: ThreadRef;
  /** Also lists resolved and snoozed items. */
  readonly includeResolved: boolean;
  readonly afterId: number;
  readonly limit: number;
}

export interface InboxSelection {
  readonly subscriber: ThreadRef;
  readonly ids: ReadonlyArray<number>;
}

/** Items to resolve: some by id, or the subscriber's open item for one event. */
export type ResolveInput = {
  readonly subscriber: ThreadRef;
  readonly disposition: string | null;
} & ({ readonly ids: ReadonlyArray<number> } | { readonly eventId: string });

export class CompanionStore extends Context.Service<
  CompanionStore,
  {
    /** Every subscription, oldest first, from memory; the writes below keep it current. */
    readonly subscriptions: Effect.Effect<ReadonlyArray<Subscription>>;
    /**
     * Adds a subscription. When the subscriber already has one on the same source with the same
     * `follow`, that one gets the new settings and is armed instead, keeping its id and inbox.
     */
    readonly upsertSubscription: (
      input: SubscriptionInput,
    ) => Effect.Effect<Subscription, CompanionStoreError>;
    readonly removeSubscriptions: (
      input: InboxSelection,
    ) => Effect.Effect<number, CompanionStoreError>;
    /** Arms or disarms subscriptions; with a subscriber, only that subscriber's. */
    readonly setArmed: (input: {
      readonly ids: ReadonlyArray<number>;
      readonly armed: boolean;
      readonly subscriber?: ThreadRef | undefined;
    }) => Effect.Effect<number, CompanionStoreError>;
    /** Inserts the subscription's inbox row; an event already in that inbox is skipped. */
    readonly deliver: (
      subscription: Subscription,
      event: ThreadEvent,
      priority: DeliveryPriority,
      passive: boolean,
    ) => Effect.Effect<InboxEvent | null, CompanionStoreError>;
    /** Subscribers whose inbox already holds this event. */
    readonly deliveredTo: (
      eventId: string,
    ) => Effect.Effect<ReadonlyArray<ThreadRef>, CompanionStoreError>;
    /** Open items: not resolved and not snoozed, unless `includeResolved`. */
    readonly listInbox: (
      query: InboxQuery,
    ) => Effect.Effect<ReadonlyArray<InboxEvent>, CompanionStoreError>;
    readonly resolve: (input: ResolveInput) => Effect.Effect<number, CompanionStoreError>;
    readonly snooze: (
      input: InboxSelection & { readonly until: string },
    ) => Effect.Effect<number, CompanionStoreError>;
    /** Snoozed, unresolved items whose snooze time has passed. */
    readonly dueSnoozes: (
      now: string,
    ) => Effect.Effect<ReadonlyArray<InboxEvent>, CompanionStoreError>;
    /** Brings a snoozed item back as a low-priority, unannounced item that may start a digest. */
    readonly redeliver: (id: number) => Effect.Effect<InboxEvent | null, CompanionStoreError>;
    /** What a subscriber's next digest carries: its open, unannounced items from wake subscriptions. */
    readonly pendingDigest: (
      subscriber: ThreadRef,
    ) => Effect.Effect<ReadonlyArray<InboxEvent>, CompanionStoreError>;
    /** A subscriber's open items from wake subscriptions that never started a digest. */
    readonly openPassive: (
      subscriber: ThreadRef,
    ) => Effect.Effect<ReadonlyArray<InboxEvent>, CompanionStoreError>;
    /** Subscribers holding an unannounced item that may start a digest. */
    readonly subscribersToWake: () => Effect.Effect<ReadonlyArray<ThreadRef>, CompanionStoreError>;
    readonly markWoken: (ids: ReadonlyArray<number>) => Effect.Effect<void, CompanionStoreError>;
    /** Rewrites an item's event, for a digest that refreshed it from the source's current state. */
    readonly updateEvent: (
      id: number,
      event: ThreadEvent,
    ) => Effect.Effect<void, CompanionStoreError>;
    /** True when another item already brought this subscriber this exact message from the thread. */
    readonly hasDeliveredMessage: (input: {
      readonly subscriber: ThreadRef;
      readonly threadId: string;
      readonly message: string;
      readonly exceptEventId: string;
    }) => Effect.Effect<boolean, CompanionStoreError>;
    readonly loadChecks: (
      environment: string,
      threadId: string,
    ) => Effect.Effect<ReadonlyMap<string, ChecksRecord>, CompanionStoreError>;
    readonly saveChecks: (
      environment: string,
      threadId: string,
      records: ReadonlyArray<ChecksRecord>,
    ) => Effect.Effect<void, CompanionStoreError>;
  }
>()("t3cli/companion/CompanionStore") {}

const toSubscription = (row: typeof SubscriptionRow.Type): Subscription => ({
  id: row.id,
  subscriber: { environment: row.subscriber_env, threadId: row.subscriber_thread },
  source: {
    environment: row.source_env,
    threadId: row.source_thread,
    projectId: row.source_project,
  },
  events: row.events,
  wake: row.wake === 1,
  follow: row.follow === 1,
  armed: row.armed === 1,
  priorities: row.priorities,
  createdAt: row.created_at,
});

const toInboxEvent = (row: typeof InboxRow.Type): InboxEvent => ({
  id: row.id,
  subscriptionId: row.subscription_id,
  subscriber: { environment: row.subscriber_env, threadId: row.subscriber_thread },
  event: row.event,
  priority: row.priority,
  passive: row.passive === 1,
  deliveredAt: row.delivered_at,
  snoozedUntil: row.snoozed_until,
  redelivered: row.redelivered,
  resolvedAt: row.resolved_at,
  disposition: row.disposition,
});

const storeError =
  (operation: string) =>
  (cause: { readonly message: string }): CompanionStoreError =>
    new CompanionStoreError({
      message: `companion store ${operation} failed`,
      operation,
      cause,
    });

const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

export const makeCompanionStore = Effect.fn("makeCompanionStore")(function* () {
  const sql = yield* SqlClient.SqlClient;

  const version = yield* Effect.gen(function* () {
    yield* sql`PRAGMA journal_mode = WAL`;
    yield* sql`PRAGMA busy_timeout = 5000`;
    const [stored] = yield* sql<{ readonly user_version: number }>`PRAGMA user_version`;
    const inbox = yield* sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'inbox'`;
    // Without an inbox the database is new, whatever its version says.
    return inbox.length === 0 ? null : (stored?.user_version ?? 0);
  }).pipe(Effect.mapError(storeError("migrate")));
  if (version !== null && (version < oldestUpgradableVersion || version > schemaVersion)) {
    return yield* new CompanionStoreError({
      message: `companion database has inbox version ${version}, and this t3cli reads versions ${oldestUpgradableVersion} to ${schemaVersion}; run the t3cli that wrote it, or move the database aside to start empty`,
      operation: "migrate",
      cause: null,
    });
  }

  yield* sql
    .withTransaction(
      Effect.gen(function* () {
        yield* sql`
          CREATE TABLE IF NOT EXISTS subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subscriber_env TEXT NOT NULL,
            subscriber_thread TEXT NOT NULL,
            source_env TEXT NOT NULL,
            source_thread TEXT,
            source_project TEXT,
            events TEXT NOT NULL,
            wake INTEGER NOT NULL,
            priorities TEXT NOT NULL DEFAULT '{}',
            follow INTEGER NOT NULL DEFAULT 0,
            armed INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            CHECK ((source_thread IS NULL) <> (source_project IS NULL))
          )
        `;
        // `wake` copies the subscription's flag: whether digests carry the item at all. A
        // `passive` item never starts one.
        yield* sql`
          CREATE TABLE IF NOT EXISTS inbox (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subscription_id INTEGER NOT NULL,
            subscriber_env TEXT NOT NULL,
            subscriber_thread TEXT NOT NULL,
            event_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            source_env TEXT NOT NULL,
            source_thread TEXT,
            event TEXT NOT NULL,
            priority TEXT NOT NULL,
            wake INTEGER NOT NULL,
            passive INTEGER NOT NULL DEFAULT 0,
            delivered_at TEXT NOT NULL,
            woken_at TEXT,
            snoozed_until TEXT,
            redelivered INTEGER NOT NULL DEFAULT 0,
            resolved_at TEXT,
            disposition TEXT,
            UNIQUE (subscriber_env, subscriber_thread, event_id)
          )
        `;
        yield* sql`
          CREATE INDEX IF NOT EXISTS inbox_subscriber
          ON inbox (subscriber_env, subscriber_thread, resolved_at, id)
        `;
        yield* sql`
          CREATE TABLE IF NOT EXISTS pr_checks (
            environment TEXT NOT NULL,
            thread_id TEXT NOT NULL,
            pr_key TEXT NOT NULL,
            head TEXT,
            state TEXT,
            cycle TEXT NOT NULL,
            PRIMARY KEY (environment, thread_id, pr_key)
          )
        `;
        if (version === 4) {
          // Version 5 turned `wakes` around into `passive`.
          yield* sql`ALTER TABLE inbox ADD COLUMN passive INTEGER NOT NULL DEFAULT 0`;
          yield* sql`UPDATE inbox SET passive = 1 - wakes`;
          yield* sql`ALTER TABLE inbox DROP COLUMN wakes`;
        }
        if (version !== null && version < 6) {
          // Version 6 split approvals out of needs-input; subscriptions that took them keep them.
          yield* sql`
            UPDATE subscriptions SET events = json_insert(events, '$[#]', 'needs-approval')
            WHERE EXISTS (SELECT 1 FROM json_each(subscriptions.events) WHERE value = 'needs-input')
              AND NOT EXISTS (
                SELECT 1 FROM json_each(subscriptions.events) WHERE value = 'needs-approval'
              )
          `;
        }
        if (version !== null && version < 7) {
          // Version 7 added stalled; whoever hears a thread go idle hears it get stuck too.
          yield* sql`
            UPDATE subscriptions SET events = json_insert(events, '$[#]', 'stalled')
            WHERE EXISTS (SELECT 1 FROM json_each(subscriptions.events) WHERE value = 'idle')
              AND NOT EXISTS (SELECT 1 FROM json_each(subscriptions.events) WHERE value = 'stalled')
          `;
        }
        yield* sql`PRAGMA user_version = ${sql.literal(String(schemaVersion))}`;
      }),
    )
    .pipe(Effect.mapError(storeError("migrate")));

  const cache = yield* Ref.make<ReadonlyArray<Subscription>>([]);
  const reload = Effect.gen(function* () {
    const rows = yield* decodeSubscriptionRows(yield* sql`SELECT * FROM subscriptions ORDER BY id`);
    yield* Ref.set(cache, rows.map(toSubscription));
  });
  yield* reload.pipe(Effect.mapError(storeError("loadSubscriptions")));

  const writing = yield* Semaphore.make(1);
  // One write at a time, each followed by a reload, so the list in memory never trails the table.
  const writeSubscriptions = <A, E, R>(write: Effect.Effect<A, E, R>) =>
    write.pipe(
      Effect.tap(() => reload),
      Semaphore.withPermits(writing, 1),
    );

  const ofSubscriber = (ref: ThreadRef) =>
    sql`subscriber_env = ${ref.environment} AND subscriber_thread = ${ref.threadId}`;
  // Open and never announced: what digests still owe the subscriber.
  const unannounced = sql`woken_at IS NULL AND resolved_at IS NULL AND snoozed_until IS NULL`;

  const upsertSubscription = Effect.fn("CompanionStore.upsertSubscription")(
    function* (input: SubscriptionInput) {
      const createdAt = yield* nowIso;
      const events = yield* encodeEvents(input.events);
      const priorities = yield* encodePriorities(input.priorities);
      const rows = yield* writeSubscriptions(
        sql.withTransaction(
          Effect.gen(function* () {
            const [existing] = yield* sql<{ readonly id: number }>`
              SELECT id FROM subscriptions
              WHERE ${ofSubscriber(input.subscriber)}
                AND source_env = ${input.source.environment}
                AND source_thread IS ${input.source.threadId}
                AND source_project IS ${input.source.projectId}
                AND follow = ${input.follow ? 1 : 0}
              ORDER BY id
              LIMIT 1
            `;
            if (existing !== undefined) {
              return yield* sql`
                UPDATE subscriptions
                SET events = ${events}, wake = ${input.wake ? 1 : 0}, priorities = ${priorities},
                  armed = 1
                WHERE id = ${existing.id}
                RETURNING *
              `;
            }
            return yield* sql`
              INSERT INTO subscriptions
                (subscriber_env, subscriber_thread, source_env, source_thread, source_project,
                 events, wake, priorities, follow, created_at)
              VALUES (
                ${input.subscriber.environment},
                ${input.subscriber.threadId},
                ${input.source.environment},
                ${input.source.threadId},
                ${input.source.projectId},
                ${events},
                ${input.wake ? 1 : 0},
                ${priorities},
                ${input.follow ? 1 : 0},
                ${createdAt}
              )
              RETURNING *
            `;
          }),
        ),
      );
      const [row] = yield* decodeSubscriptionRows(rows);
      if (row === undefined) {
        return yield* Effect.die("a subscription write returned no row");
      }
      return toSubscription(row);
    },
    Effect.mapError(storeError("upsertSubscription")),
  );

  const removeSubscriptions = Effect.fn("CompanionStore.removeSubscriptions")(
    function* (input: InboxSelection) {
      if (input.ids.length === 0) {
        return 0;
      }
      const rows = yield* writeSubscriptions(sql`
        DELETE FROM subscriptions
        WHERE ${ofSubscriber(input.subscriber)} AND ${sql.in("id", input.ids)}
        RETURNING id
      `);
      return rows.length;
    },
    Effect.mapError(storeError("removeSubscriptions")),
  );

  const setArmed = Effect.fn("CompanionStore.setArmed")(
    function* (input: {
      readonly ids: ReadonlyArray<number>;
      readonly armed: boolean;
      readonly subscriber?: ThreadRef | undefined;
    }) {
      if (input.ids.length === 0) {
        return 0;
      }
      const rows = yield* writeSubscriptions(sql`
        UPDATE subscriptions SET armed = ${input.armed ? 1 : 0}
        WHERE ${sql.and([
          sql.in("id", input.ids),
          ...(input.subscriber === undefined ? [] : [ofSubscriber(input.subscriber)]),
        ])}
        RETURNING id
      `);
      return rows.length;
    },
    Effect.mapError(storeError("setArmed")),
  );

  const deliver = Effect.fn("CompanionStore.deliver")(
    function* (
      subscription: Subscription,
      event: ThreadEvent,
      priority: DeliveryPriority,
      passive: boolean,
    ) {
      const deliveredAt = yield* nowIso;
      const encoded = yield* encodeEvent(event);
      const rows = yield* sql`
        INSERT OR IGNORE INTO inbox
          (subscription_id, subscriber_env, subscriber_thread, event_id, kind, source_env,
           source_thread, event, priority, wake, passive, delivered_at)
        VALUES (
          ${subscription.id},
          ${subscription.subscriber.environment},
          ${subscription.subscriber.threadId},
          ${event.eventId},
          ${event.kind},
          ${event.environment},
          ${event.threadId},
          ${encoded},
          ${priority},
          ${subscription.wake ? 1 : 0},
          ${passive ? 1 : 0},
          ${deliveredAt}
        )
        RETURNING *
      `;
      const [row] = yield* decodeInboxRows(rows);
      return row === undefined ? null : toInboxEvent(row);
    },
    Effect.mapError(storeError("deliver")),
  );

  const deliveredTo = Effect.fn("CompanionStore.deliveredTo")(
    function* (eventId: string) {
      return yield* sql<ThreadRef>`
      SELECT subscriber_env AS environment, subscriber_thread AS "threadId"
      FROM inbox WHERE event_id = ${eventId}
    `;
    },
    Effect.mapError(storeError("deliveredTo")),
  );

  const listInbox = Effect.fn("CompanionStore.listInbox")(
    function* (query: InboxQuery) {
      const rows = yield* sql`
        SELECT * FROM inbox
        WHERE ${ofSubscriber(query.subscriber)}
          AND id > ${query.afterId}
          AND (${query.includeResolved ? 1 : 0} = 1 OR (resolved_at IS NULL AND snoozed_until IS NULL))
        ORDER BY id
        LIMIT ${query.limit}
      `;
      return (yield* decodeInboxRows(rows)).map(toInboxEvent);
    },
    Effect.mapError(storeError("listInbox")),
  );

  const resolve = Effect.fn("CompanionStore.resolve")(
    function* (input: ResolveInput) {
      if ("ids" in input && input.ids.length === 0) {
        return 0;
      }
      const resolvedAt = yield* nowIso;
      const rows = yield* sql`
        UPDATE inbox SET resolved_at = ${resolvedAt}, disposition = ${input.disposition},
          snoozed_until = NULL
        WHERE ${ofSubscriber(input.subscriber)}
          AND resolved_at IS NULL
          AND ${"ids" in input ? sql.in("id", input.ids) : sql`event_id = ${input.eventId}`}
        RETURNING id
      `;
      return rows.length;
    },
    Effect.mapError(storeError("resolve")),
  );

  const snooze = Effect.fn("CompanionStore.snooze")(
    function* (input: InboxSelection & { readonly until: string }) {
      if (input.ids.length === 0) {
        return 0;
      }
      const rows = yield* sql`
        UPDATE inbox SET snoozed_until = ${input.until}
        WHERE ${ofSubscriber(input.subscriber)}
          AND resolved_at IS NULL
          AND ${sql.in("id", input.ids)}
        RETURNING id
      `;
      return rows.length;
    },
    Effect.mapError(storeError("snooze")),
  );

  const dueSnoozes = Effect.fn("CompanionStore.dueSnoozes")(
    function* (now: string) {
      const rows = yield* sql`
        SELECT * FROM inbox
        WHERE snoozed_until IS NOT NULL AND snoozed_until <= ${now} AND resolved_at IS NULL
        ORDER BY id
      `;
      return (yield* decodeInboxRows(rows)).map(toInboxEvent);
    },
    Effect.mapError(storeError("dueSnoozes")),
  );

  const redeliver = Effect.fn("CompanionStore.redeliver")(
    function* (id: number) {
      const rows = yield* sql`
        UPDATE inbox
        SET snoozed_until = NULL, redelivered = redelivered + 1, woken_at = NULL, priority = 'low',
          passive = 0
        WHERE id = ${id} AND snoozed_until IS NOT NULL AND resolved_at IS NULL
        RETURNING *
      `;
      const [row] = yield* decodeInboxRows(rows);
      return row === undefined ? null : toInboxEvent(row);
    },
    Effect.mapError(storeError("redeliver")),
  );

  const pendingDigest = Effect.fn("CompanionStore.pendingDigest")(
    function* (subscriber: ThreadRef) {
      const rows = yield* sql`
        SELECT * FROM inbox
        WHERE ${ofSubscriber(subscriber)} AND wake = 1 AND ${unannounced}
        ORDER BY id
      `;
      return (yield* decodeInboxRows(rows)).map(toInboxEvent);
    },
    Effect.mapError(storeError("pendingDigest")),
  );

  const openPassive = Effect.fn("CompanionStore.openPassive")(
    function* (subscriber: ThreadRef) {
      const rows = yield* sql`
        SELECT * FROM inbox
        WHERE ${ofSubscriber(subscriber)} AND wake = 1 AND passive = 1
          AND resolved_at IS NULL AND snoozed_until IS NULL
        ORDER BY id
      `;
      return (yield* decodeInboxRows(rows)).map(toInboxEvent);
    },
    Effect.mapError(storeError("openPassive")),
  );

  const subscribersToWake = Effect.fn("CompanionStore.subscribersToWake")(
    function* () {
      return yield* sql<ThreadRef>`
      SELECT DISTINCT subscriber_env AS environment, subscriber_thread AS "threadId"
      FROM inbox WHERE wake = 1 AND passive = 0 AND ${unannounced}
    `;
    },
    Effect.mapError(storeError("subscribersToWake")),
  );

  const markWoken = Effect.fn("CompanionStore.markWoken")(
    function* (ids: ReadonlyArray<number>) {
      if (ids.length === 0) {
        return;
      }
      const wokenAt = yield* nowIso;
      yield* sql`UPDATE inbox SET woken_at = ${wokenAt} WHERE ${sql.in("id", ids)}`;
    },
    Effect.mapError(storeError("markWoken")),
  );

  const updateEvent = Effect.fn("CompanionStore.updateEvent")(
    function* (id: number, event: ThreadEvent) {
      yield* sql`UPDATE inbox SET event = ${yield* encodeEvent(event)} WHERE id = ${id}`;
    },
    Effect.mapError(storeError("updateEvent")),
  );

  const hasDeliveredMessage = Effect.fn("CompanionStore.hasDeliveredMessage")(
    function* (input: {
      readonly subscriber: ThreadRef;
      readonly threadId: string;
      readonly message: string;
      readonly exceptEventId: string;
    }) {
      const rows = yield* sql`
        SELECT 1 FROM inbox
        WHERE ${ofSubscriber(input.subscriber)}
          AND source_thread = ${input.threadId}
          AND event_id <> ${input.exceptEventId}
          AND json_extract(event, '$.lastMessage') = ${input.message}
        LIMIT 1
      `;
      return rows.length > 0;
    },
    Effect.mapError(storeError("hasDeliveredMessage")),
  );

  const loadChecks = Effect.fn("CompanionStore.loadChecks")(
    function* (environment: string, threadId: string) {
      const rows = yield* decodeChecksRows(
        yield* sql`
          SELECT pr_key, head, state, cycle FROM pr_checks
          WHERE environment = ${environment} AND thread_id = ${threadId}
        `,
      );
      return new Map(
        rows.map((row) => [
          row.pr_key,
          { key: row.pr_key, head: row.head, state: row.state, cycle: row.cycle },
        ]),
      );
    },
    Effect.mapError(storeError("loadChecks")),
  );

  const saveChecks = Effect.fn("CompanionStore.saveChecks")(
    function* (environment: string, threadId: string, records: ReadonlyArray<ChecksRecord>) {
      for (const record of records) {
        yield* sql`
          INSERT INTO pr_checks (environment, thread_id, pr_key, head, state, cycle)
          VALUES (${environment}, ${threadId}, ${record.key}, ${record.head}, ${record.state}, ${record.cycle})
          ON CONFLICT (environment, thread_id, pr_key)
          DO UPDATE SET head = excluded.head, state = excluded.state, cycle = excluded.cycle
        `;
      }
    },
    Effect.mapError(storeError("saveChecks")),
  );

  return CompanionStore.of({
    subscriptions: Ref.get(cache),
    upsertSubscription,
    removeSubscriptions,
    setArmed,
    deliver,
    deliveredTo,
    listInbox,
    resolve,
    snooze,
    dueSnoozes,
    redeliver,
    pendingDigest,
    openPassive,
    subscribersToWake,
    markWoken,
    updateEvent,
    hasDeliveredMessage,
    loadChecks,
    saveChecks,
  });
});

export const CompanionStoreLive = Layer.effect(CompanionStore, makeCompanionStore());
