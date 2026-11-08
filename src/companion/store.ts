import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { CompanionStoreError } from "./error.ts";
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
  delivered_at: Schema.String,
  snoozed_until: Schema.NullOr(Schema.String),
  redelivered: Schema.Number,
  resolved_at: Schema.NullOr(Schema.String),
  disposition: Schema.NullOr(Schema.String),
});
const decodeInboxRows = Schema.decodeUnknownEffect(Schema.Array(InboxRow));

const encodeEvents = Schema.encodeEffect(Schema.fromJsonString(Schema.Array(CompanionEventKind)));
const encodePriorities = Schema.encodeEffect(Schema.fromJsonString(Priorities));
const encodeEvent = Schema.encodeEffect(Schema.fromJsonString(ThreadEvent));

/** Inbox schema version, kept in `PRAGMA user_version`. */
const schemaVersion = 2;

export interface AddSubscriptionInput {
  readonly subscriber: ThreadRef;
  readonly source: SubscriptionSource;
  readonly events: ReadonlyArray<CompanionEventKind>;
  readonly wake: boolean;
  readonly priorities: Readonly<Record<string, DeliveryPriority>>;
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

export class CompanionStore extends Context.Service<
  CompanionStore,
  {
    readonly addSubscription: (
      input: AddSubscriptionInput,
    ) => Effect.Effect<Subscription, CompanionStoreError>;
    readonly removeSubscriptions: (
      input: InboxSelection,
    ) => Effect.Effect<number, CompanionStoreError>;
    readonly listSubscriptions: (
      subscriber: ThreadRef | null,
    ) => Effect.Effect<ReadonlyArray<Subscription>, CompanionStoreError>;
    /** Inserts the subscription's inbox row; an event already in that inbox is skipped. */
    readonly deliver: (
      subscription: Subscription,
      event: ThreadEvent,
      priority: DeliveryPriority,
    ) => Effect.Effect<InboxEvent | null, CompanionStoreError>;
    /** Subscribers whose inbox already holds this event. */
    readonly deliveredTo: (
      eventId: string,
    ) => Effect.Effect<ReadonlyArray<ThreadRef>, CompanionStoreError>;
    /** Open items: not resolved and not snoozed, unless `includeResolved`. */
    readonly listInbox: (
      query: InboxQuery,
    ) => Effect.Effect<ReadonlyArray<InboxEvent>, CompanionStoreError>;
    readonly resolve: (
      input: InboxSelection & { readonly disposition: string | null },
    ) => Effect.Effect<number, CompanionStoreError>;
    readonly snooze: (
      input: InboxSelection & { readonly until: string },
    ) => Effect.Effect<number, CompanionStoreError>;
    /** Snoozed, unresolved items whose snooze time has passed. */
    readonly dueSnoozes: (
      now: string,
    ) => Effect.Effect<ReadonlyArray<InboxEvent>, CompanionStoreError>;
    /** Brings a snoozed item back as a low-priority, unannounced item. */
    readonly redeliver: (id: number) => Effect.Effect<InboxEvent | null, CompanionStoreError>;
    /** Open items from wake subscriptions that no digest has announced yet. */
    readonly pendingWakes: () => Effect.Effect<ReadonlyArray<InboxEvent>, CompanionStoreError>;
    readonly markWoken: (ids: ReadonlyArray<number>) => Effect.Effect<void, CompanionStoreError>;
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
  priorities: row.priorities,
  createdAt: row.created_at,
});

const toInboxEvent = (row: typeof InboxRow.Type): InboxEvent => ({
  id: row.id,
  subscriptionId: row.subscription_id,
  subscriber: { environment: row.subscriber_env, threadId: row.subscriber_thread },
  event: row.event,
  priority: row.priority,
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

  const createInbox = (table: string) => sql`
    CREATE TABLE ${sql(table)} (
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
      delivered_at TEXT NOT NULL,
      woken_at TEXT,
      snoozed_until TEXT,
      redelivered INTEGER NOT NULL DEFAULT 0,
      resolved_at TEXT,
      disposition TEXT,
      UNIQUE (subscriber_env, subscriber_thread, event_id)
    )
  `;

  yield* Effect.gen(function* () {
    yield* sql`PRAGMA journal_mode = WAL`;
    yield* sql`PRAGMA busy_timeout = 5000`;
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
        created_at TEXT NOT NULL,
        CHECK ((source_thread IS NULL) <> (source_project IS NULL))
      )
    `;
    const [version] = yield* sql<{ readonly user_version: number }>`PRAGMA user_version`;
    if ((version?.user_version ?? 0) >= schemaVersion) {
      return;
    }
    yield* sql.withTransaction(
      Effect.gen(function* () {
        const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(subscriptions)`;
        if (!columns.some((column) => column.name === "priorities")) {
          yield* sql`ALTER TABLE subscriptions ADD COLUMN priorities TEXT NOT NULL DEFAULT '{}'`;
        }
        const existing = yield* sql<{
          readonly name: string;
        }>`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'inbox'`;
        if (existing.length === 0) {
          yield* createInbox("inbox");
        } else {
          // Versions 0 and 1 kept the event in columns and had a plain ack.
          yield* createInbox("inbox_v2");
          yield* sql`
            INSERT INTO inbox_v2
              (id, subscription_id, subscriber_env, subscriber_thread, event_id, kind, source_env,
               source_thread, event, priority, wake, delivered_at, woken_at, resolved_at, disposition)
            SELECT
              id, subscription_id, subscriber_env, subscriber_thread, event_id, kind, source_env,
              source_thread,
              json_object(
                'eventId', event_id, 'kind', kind, 'environment', source_env,
                'threadId', source_thread, 'projectId', source_project, 'title', title,
                'occurredAt', occurred_at, 'summary', summary, 'pause', json('false'),
                'pendingTasks', json('[]'), 'lastMessage', NULL, 'pullRequests', json('[]')
              ),
              CASE kind
                WHEN 'failed' THEN 'urgent'
                WHEN 'needs-input' THEN 'urgent'
                WHEN 'idle' THEN 'normal'
                WHEN 'env-down' THEN 'normal'
                ELSE 'low'
              END,
              wake, delivered_at, woken_at, acked_at,
              CASE WHEN acked_at IS NULL THEN NULL ELSE 'acked' END
            FROM inbox
          `;
          yield* sql`DROP TABLE inbox`;
          yield* sql`ALTER TABLE inbox_v2 RENAME TO inbox`;
        }
        yield* sql`
          CREATE INDEX IF NOT EXISTS inbox_subscriber
          ON inbox (subscriber_env, subscriber_thread, resolved_at, id)
        `;
        yield* sql`PRAGMA user_version = ${sql.literal(String(schemaVersion))}`;
      }),
    );
  }).pipe(Effect.mapError(storeError("migrate")));

  const addSubscription = Effect.fn("CompanionStore.addSubscription")(
    function* (input: AddSubscriptionInput) {
      const createdAt = yield* nowIso;
      const events = yield* encodeEvents(input.events);
      const priorities = yield* encodePriorities(input.priorities);
      const rows = yield* sql`
        INSERT INTO subscriptions
          (subscriber_env, subscriber_thread, source_env, source_thread, source_project, events, wake,
           priorities, created_at)
        VALUES (
          ${input.subscriber.environment},
          ${input.subscriber.threadId},
          ${input.source.environment},
          ${input.source.threadId},
          ${input.source.projectId},
          ${events},
          ${input.wake ? 1 : 0},
          ${priorities},
          ${createdAt}
        )
        RETURNING *
      `;
      const [row] = yield* decodeSubscriptionRows(rows);
      if (row === undefined) {
        return yield* Effect.die("INSERT ... RETURNING produced no row");
      }
      return toSubscription(row);
    },
    Effect.mapError(storeError("addSubscription")),
  );

  const removeSubscriptions = Effect.fn("CompanionStore.removeSubscriptions")(
    function* (input: InboxSelection) {
      if (input.ids.length === 0) {
        return 0;
      }
      const rows = yield* sql`
        DELETE FROM subscriptions
        WHERE subscriber_env = ${input.subscriber.environment}
          AND subscriber_thread = ${input.subscriber.threadId}
          AND ${sql.in("id", input.ids)}
        RETURNING id
      `;
      return rows.length;
    },
    Effect.mapError(storeError("removeSubscriptions")),
  );

  const listSubscriptions = Effect.fn("CompanionStore.listSubscriptions")(
    function* (subscriber: ThreadRef | null) {
      const rows =
        subscriber === null
          ? yield* sql`SELECT * FROM subscriptions ORDER BY id`
          : yield* sql`
              SELECT * FROM subscriptions
              WHERE subscriber_env = ${subscriber.environment}
                AND subscriber_thread = ${subscriber.threadId}
              ORDER BY id
            `;
      return (yield* decodeSubscriptionRows(rows)).map(toSubscription);
    },
    Effect.mapError(storeError("listSubscriptions")),
  );

  const deliver = Effect.fn("CompanionStore.deliver")(
    function* (subscription: Subscription, event: ThreadEvent, priority: DeliveryPriority) {
      const deliveredAt = yield* nowIso;
      const encoded = yield* encodeEvent(event);
      const rows = yield* sql`
        INSERT OR IGNORE INTO inbox
          (subscription_id, subscriber_env, subscriber_thread, event_id, kind, source_env,
           source_thread, event, priority, wake, delivered_at)
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
      const rows = yield* sql<{
        readonly subscriber_env: string;
        readonly subscriber_thread: string;
      }>`SELECT subscriber_env, subscriber_thread FROM inbox WHERE event_id = ${eventId}`;
      return rows.map((row) => ({
        environment: row.subscriber_env,
        threadId: row.subscriber_thread,
      }));
    },
    Effect.mapError(storeError("deliveredTo")),
  );

  const listInbox = Effect.fn("CompanionStore.listInbox")(
    function* (query: InboxQuery) {
      const rows = yield* sql`
        SELECT * FROM inbox
        WHERE subscriber_env = ${query.subscriber.environment}
          AND subscriber_thread = ${query.subscriber.threadId}
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
    function* (input: InboxSelection & { readonly disposition: string | null }) {
      if (input.ids.length === 0) {
        return 0;
      }
      const resolvedAt = yield* nowIso;
      const rows = yield* sql`
        UPDATE inbox SET resolved_at = ${resolvedAt}, disposition = ${input.disposition},
          snoozed_until = NULL
        WHERE subscriber_env = ${input.subscriber.environment}
          AND subscriber_thread = ${input.subscriber.threadId}
          AND resolved_at IS NULL
          AND ${sql.in("id", input.ids)}
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
        WHERE subscriber_env = ${input.subscriber.environment}
          AND subscriber_thread = ${input.subscriber.threadId}
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
        SET snoozed_until = NULL, redelivered = redelivered + 1, woken_at = NULL, priority = 'low'
        WHERE id = ${id} AND snoozed_until IS NOT NULL AND resolved_at IS NULL
        RETURNING *
      `;
      const [row] = yield* decodeInboxRows(rows);
      return row === undefined ? null : toInboxEvent(row);
    },
    Effect.mapError(storeError("redeliver")),
  );

  const pendingWakes = Effect.fn("CompanionStore.pendingWakes")(
    function* () {
      const rows = yield* sql`
        SELECT * FROM inbox
        WHERE wake = 1 AND woken_at IS NULL AND resolved_at IS NULL AND snoozed_until IS NULL
        ORDER BY id
      `;
      return (yield* decodeInboxRows(rows)).map(toInboxEvent);
    },
    Effect.mapError(storeError("pendingWakes")),
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

  return CompanionStore.of({
    addSubscription,
    removeSubscriptions,
    listSubscriptions,
    deliver,
    deliveredTo,
    listInbox,
    resolve,
    snooze,
    dueSnoozes,
    redeliver,
    pendingWakes,
    markWoken,
  });
});

export const CompanionStoreLive = Layer.effect(CompanionStore, makeCompanionStore());
