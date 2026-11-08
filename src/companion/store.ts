import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { CompanionStoreError } from "./error.ts";
import {
  CompanionEventKind,
  type InboxEvent,
  type Subscription,
  type SubscriptionSource,
  type ThreadEvent,
  type ThreadRef,
} from "./schema.ts";

const SubscriptionRow = Schema.Struct({
  id: Schema.Number,
  subscriber_env: Schema.String,
  subscriber_thread: Schema.String,
  source_env: Schema.String,
  source_thread: Schema.NullOr(Schema.String),
  source_project: Schema.NullOr(Schema.String),
  events: Schema.fromJsonString(Schema.Array(CompanionEventKind)),
  wake: Schema.Number,
  created_at: Schema.String,
});
const decodeSubscriptionRows = Schema.decodeUnknownEffect(Schema.Array(SubscriptionRow));

const InboxRow = Schema.Struct({
  id: Schema.Number,
  subscription_id: Schema.Number,
  subscriber_env: Schema.String,
  subscriber_thread: Schema.String,
  event_id: Schema.String,
  kind: CompanionEventKind,
  source_env: Schema.String,
  source_thread: Schema.String,
  source_project: Schema.String,
  title: Schema.String,
  occurred_at: Schema.String,
  summary: Schema.String,
  delivered_at: Schema.String,
  acked_at: Schema.NullOr(Schema.String),
});
const decodeInboxRows = Schema.decodeUnknownEffect(Schema.Array(InboxRow));

const encodeEvents = Schema.encodeEffect(Schema.fromJsonString(Schema.Array(CompanionEventKind)));

export interface AddSubscriptionInput {
  readonly subscriber: ThreadRef;
  readonly source: SubscriptionSource;
  readonly events: ReadonlyArray<CompanionEventKind>;
  readonly wake: boolean;
}

export interface InboxQuery {
  readonly subscriber: ThreadRef;
  readonly includeAcked: boolean;
  readonly afterId: number;
  readonly limit: number;
}

export class CompanionStore extends Context.Service<
  CompanionStore,
  {
    readonly addSubscription: (
      input: AddSubscriptionInput,
    ) => Effect.Effect<Subscription, CompanionStoreError>;
    readonly removeSubscriptions: (input: {
      readonly subscriber: ThreadRef;
      readonly ids: ReadonlyArray<number>;
    }) => Effect.Effect<number, CompanionStoreError>;
    readonly listSubscriptions: (
      subscriber: ThreadRef | null,
    ) => Effect.Effect<ReadonlyArray<Subscription>, CompanionStoreError>;
    /** Inserts one inbox row per subscription; events already delivered are skipped. */
    readonly deliver: (
      subscription: Subscription,
      event: ThreadEvent,
    ) => Effect.Effect<InboxEvent | null, CompanionStoreError>;
    readonly listInbox: (
      query: InboxQuery,
    ) => Effect.Effect<ReadonlyArray<InboxEvent>, CompanionStoreError>;
    readonly ack: (input: {
      readonly subscriber: ThreadRef;
      readonly ids: ReadonlyArray<number>;
    }) => Effect.Effect<number, CompanionStoreError>;
    /** Inbox rows from wake subscriptions that no digest has announced yet. */
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
  createdAt: row.created_at,
});

const toInboxEvent = (row: typeof InboxRow.Type): InboxEvent => ({
  id: row.id,
  subscriptionId: row.subscription_id,
  subscriber: { environment: row.subscriber_env, threadId: row.subscriber_thread },
  event: {
    eventId: row.event_id,
    kind: row.kind,
    environment: row.source_env,
    threadId: row.source_thread,
    projectId: row.source_project,
    title: row.title,
    occurredAt: row.occurred_at,
    summary: row.summary,
  },
  deliveredAt: row.delivered_at,
  ackedAt: row.acked_at,
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
        created_at TEXT NOT NULL,
        CHECK ((source_thread IS NULL) <> (source_project IS NULL))
      )
    `;
    yield* sql`
      CREATE TABLE IF NOT EXISTS inbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subscription_id INTEGER NOT NULL,
        subscriber_env TEXT NOT NULL,
        subscriber_thread TEXT NOT NULL,
        event_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        source_env TEXT NOT NULL,
        source_thread TEXT NOT NULL,
        source_project TEXT NOT NULL,
        title TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        summary TEXT NOT NULL,
        wake INTEGER NOT NULL,
        delivered_at TEXT NOT NULL,
        woken_at TEXT,
        acked_at TEXT,
        UNIQUE (subscriber_env, subscriber_thread, event_id)
      )
    `;
    yield* sql`
      CREATE INDEX IF NOT EXISTS inbox_subscriber
      ON inbox (subscriber_env, subscriber_thread, acked_at, id)
    `;
  }).pipe(Effect.mapError(storeError("migrate")));

  const addSubscription = Effect.fn("CompanionStore.addSubscription")(
    function* (input: AddSubscriptionInput) {
      const createdAt = yield* nowIso;
      const events = yield* encodeEvents(input.events);
      const rows = yield* sql`
        INSERT INTO subscriptions
          (subscriber_env, subscriber_thread, source_env, source_thread, source_project, events, wake, created_at)
        VALUES (
          ${input.subscriber.environment},
          ${input.subscriber.threadId},
          ${input.source.environment},
          ${input.source.threadId},
          ${input.source.projectId},
          ${events},
          ${input.wake ? 1 : 0},
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
    function* (input: { readonly subscriber: ThreadRef; readonly ids: ReadonlyArray<number> }) {
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
    function* (subscription: Subscription, event: ThreadEvent) {
      const deliveredAt = yield* nowIso;
      const rows = yield* sql`
        INSERT OR IGNORE INTO inbox
          (subscription_id, subscriber_env, subscriber_thread, event_id, kind, source_env,
           source_thread, source_project, title, occurred_at, summary, wake, delivered_at)
        VALUES (
          ${subscription.id},
          ${subscription.subscriber.environment},
          ${subscription.subscriber.threadId},
          ${event.eventId},
          ${event.kind},
          ${event.environment},
          ${event.threadId},
          ${event.projectId},
          ${event.title},
          ${event.occurredAt},
          ${event.summary},
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

  const listInbox = Effect.fn("CompanionStore.listInbox")(
    function* (query: InboxQuery) {
      const rows = yield* sql`
        SELECT * FROM inbox
        WHERE subscriber_env = ${query.subscriber.environment}
          AND subscriber_thread = ${query.subscriber.threadId}
          AND id > ${query.afterId}
          AND (${query.includeAcked ? 1 : 0} = 1 OR acked_at IS NULL)
        ORDER BY id
        LIMIT ${query.limit}
      `;
      return (yield* decodeInboxRows(rows)).map(toInboxEvent);
    },
    Effect.mapError(storeError("listInbox")),
  );

  const ack = Effect.fn("CompanionStore.ack")(
    function* (input: { readonly subscriber: ThreadRef; readonly ids: ReadonlyArray<number> }) {
      if (input.ids.length === 0) {
        return 0;
      }
      const ackedAt = yield* nowIso;
      const rows = yield* sql`
        UPDATE inbox SET acked_at = ${ackedAt}
        WHERE subscriber_env = ${input.subscriber.environment}
          AND subscriber_thread = ${input.subscriber.threadId}
          AND acked_at IS NULL
          AND ${sql.in("id", input.ids)}
        RETURNING id
      `;
      return rows.length;
    },
    Effect.mapError(storeError("ack")),
  );

  const pendingWakes = Effect.fn("CompanionStore.pendingWakes")(
    function* () {
      const rows = yield* sql`
        SELECT * FROM inbox
        WHERE wake = 1 AND woken_at IS NULL AND acked_at IS NULL
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
    listInbox,
    ack,
    pendingWakes,
    markWoken,
  });
});

export const CompanionStoreLive = Layer.effect(CompanionStore, makeCompanionStore());
