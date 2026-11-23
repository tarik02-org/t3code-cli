import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { CompanionStoreError } from "./error.ts";
import {
  type CompanionEvent,
  EventKind,
  EventPayload,
  type Reminder,
  type ThreadRef,
  WatchMemory,
  WatchOrigin,
} from "./schema.ts";

const MemoryJson = Schema.fromJsonString(WatchMemory);
const PayloadJson = Schema.fromJsonString(EventPayload);

const CallerRow = Schema.Struct({
  env: Schema.String,
  thread: Schema.String,
  enrolled_at: Schema.String,
  cursor: Schema.Number,
});
const decodeCallerRows = Schema.decodeUnknownEffect(Schema.Array(CallerRow));

const WatchRow = Schema.Struct({
  id: Schema.Number,
  caller_env: Schema.String,
  caller_thread: Schema.String,
  subject: Schema.String,
  origin: WatchOrigin,
  since: Schema.String,
  green: Schema.Number,
  memory: MemoryJson,
  ended_at: Schema.NullOr(Schema.String),
  ended_reason: Schema.NullOr(Schema.String),
});
const decodeWatchRows = Schema.decodeUnknownEffect(Schema.Array(WatchRow));

const EventRow = Schema.Struct({
  id: Schema.Number,
  caller_env: Schema.String,
  caller_thread: Schema.String,
  subject: Schema.String,
  kind: EventKind,
  key: Schema.String,
  urgent: Schema.Number,
  at: Schema.String,
  state: Schema.Literals(["pending", "delivered", "taken", "dropped"]),
  payload: PayloadJson,
});
const decodeEventRows = Schema.decodeUnknownEffect(Schema.Array(EventRow));

const DigestRow = Schema.Struct({
  id: Schema.Number,
  caller_env: Schema.String,
  caller_thread: Schema.String,
  text: Schema.String,
  mode: Schema.Literals(["auto", "steer"]),
  created_at: Schema.String,
});
const decodeDigestRows = Schema.decodeUnknownEffect(Schema.Array(DigestRow));

const ReminderRow = Schema.Struct({
  id: Schema.Number,
  caller_env: Schema.String,
  caller_thread: Schema.String,
  due_at: Schema.String,
  text: Schema.String,
});
const decodeReminderRows = Schema.decodeUnknownEffect(Schema.Array(ReminderRow));

const encodeMemory = Schema.encodeEffect(MemoryJson);
const encodePayload = Schema.encodeEffect(PayloadJson);

/**
 * Schema version, kept in `PRAGMA user_version`. Version 8 held waits and their firings;
 * earlier ones subscriptions and an inbox.
 */
const schemaVersion = 9;

export interface StoredCaller {
  readonly ref: ThreadRef;
  readonly enrolledAt: string;
  /** The ordinal of the last transcript item scanned for threads the caller wrote to. */
  readonly cursor: number;
}

export interface StoredWatch {
  readonly id: number;
  readonly caller: ThreadRef;
  readonly subject: string;
  readonly origin: WatchOrigin;
  /** Only what happens after this instant is an event. */
  readonly since: string;
  readonly green: boolean;
  readonly memory: WatchMemory;
  readonly endedAt: string | null;
  /** `unwatched`, `gone`, `merged` or `closed`. */
  readonly endedReason: string | null;
}

export interface NewEvent {
  readonly caller: ThreadRef;
  readonly subject: string;
  readonly kind: EventKind;
  readonly key: string;
  readonly urgent: boolean;
  readonly at: string;
  readonly payload: EventPayload;
}

/** A message that was stored to be sent and has not been confirmed sent. */
export interface StoredDigest {
  readonly id: number;
  readonly caller: ThreadRef;
  readonly text: string;
  readonly mode: "auto" | "steer";
  readonly createdAt: string;
}

export interface StoredReminder extends Reminder {
  readonly caller: ThreadRef;
}

export class CompanionStore extends Context.Service<
  CompanionStore,
  {
    readonly callers: () => Effect.Effect<ReadonlyArray<StoredCaller>, CompanionStoreError>;
    /** Makes a thread a caller; leaves one that already is as it was. */
    readonly enroll: (ref: ThreadRef, at: string) => Effect.Effect<void, CompanionStoreError>;
    readonly setCursor: (
      ref: ThreadRef,
      cursor: number,
    ) => Effect.Effect<void, CompanionStoreError>;
    /** Forgets a caller: its watches, reminders, digests and events go with it. */
    readonly removeCaller: (ref: ThreadRef) => Effect.Effect<void, CompanionStoreError>;

    /** Every watch, ended ones too: an ended watch says why its subject is not watched again. */
    readonly watches: () => Effect.Effect<ReadonlyArray<StoredWatch>, CompanionStoreError>;
    /** Starts a watch, or restarts the caller's ended watch of the same subject. */
    readonly startWatch: (input: {
      readonly caller: ThreadRef;
      readonly subject: string;
      readonly origin: WatchOrigin;
      readonly since: string;
      readonly green: boolean;
      readonly memory: WatchMemory;
    }) => Effect.Effect<StoredWatch, CompanionStoreError>;
    readonly endWatch: (
      id: number,
      reason: string,
      at: string,
    ) => Effect.Effect<void, CompanionStoreError>;
    readonly setGreen: (id: number, green: boolean) => Effect.Effect<void, CompanionStoreError>;
    /**
     * Records what a watch has now reported together with the events that report it, so a
     * transition is either remembered and stored or neither.
     */
    readonly emit: (
      watch: { readonly id: number; readonly memory: WatchMemory } | null,
      events: ReadonlyArray<NewEvent>,
    ) => Effect.Effect<ReadonlyArray<CompanionEvent>, CompanionStoreError>;

    /** Events no digest carries yet; every caller's when `caller` is null. */
    readonly pendingEvents: (
      caller: ThreadRef | null,
    ) => Effect.Effect<ReadonlyArray<CompanionEvent>, CompanionStoreError>;
    readonly event: (
      caller: ThreadRef,
      id: number,
    ) => Effect.Effect<CompanionEvent | null, CompanionStoreError>;
    /** Closes pending events that will not be sent: `taken` by the caller, or `dropped`. */
    readonly settle: (
      ids: ReadonlyArray<number>,
      state: "taken" | "dropped",
      at: string,
    ) => Effect.Effect<void, CompanionStoreError>;
    /** Drops the pending events about a subject no longer watched. */
    readonly dropSubject: (
      caller: ThreadRef,
      subject: string,
      at: string,
    ) => Effect.Effect<void, CompanionStoreError>;

    /** Stores a digest and the events it carries before it is sent. */
    readonly openDigest: (input: {
      readonly caller: ThreadRef;
      /** The digest's text, which names its id. */
      readonly text: (id: number) => string;
      readonly mode: "auto" | "steer";
      readonly at: string;
      readonly eventIds: ReadonlyArray<number>;
    }) => Effect.Effect<StoredDigest, CompanionStoreError>;
    /** The digest reached its caller: its events are delivered. */
    readonly closeDigest: (id: number, at: string) => Effect.Effect<void, CompanionStoreError>;
    /** The digest did not reach its caller: its events are pending again. */
    readonly abandonDigest: (id: number) => Effect.Effect<void, CompanionStoreError>;
    /** Digests stored and not confirmed sent, oldest first. */
    readonly openDigests: () => Effect.Effect<ReadonlyArray<StoredDigest>, CompanionStoreError>;

    readonly addReminder: (input: {
      readonly caller: ThreadRef;
      readonly dueAt: string;
      readonly text: string;
      readonly at: string;
    }) => Effect.Effect<StoredReminder, CompanionStoreError>;
    readonly reminders: () => Effect.Effect<ReadonlyArray<StoredReminder>, CompanionStoreError>;
    /** False when the caller has no such pending reminder. */
    readonly cancelReminder: (
      caller: ThreadRef,
      id: number,
    ) => Effect.Effect<boolean, CompanionStoreError>;
    /** Turns a due reminder into its event; nothing when it is no longer pending. */
    readonly fireReminder: (
      id: number,
      event: NewEvent,
    ) => Effect.Effect<void, CompanionStoreError>;

    /**
     * Removes settled events, closed digests and fired reminders older than `before`. Ended
     * watches stay: they keep an unwatched pull request from being picked up again from its link.
     */
    readonly prune: (before: string) => Effect.Effect<void, CompanionStoreError>;
  }
>()("t3cli/companion/CompanionStore") {}

const toWatch = (row: typeof WatchRow.Type): StoredWatch => ({
  id: row.id,
  caller: { environment: row.caller_env, threadId: row.caller_thread },
  subject: row.subject,
  origin: row.origin,
  since: row.since,
  green: row.green === 1,
  memory: row.memory,
  endedAt: row.ended_at,
  endedReason: row.ended_reason,
});

const toEvent = (row: typeof EventRow.Type): CompanionEvent => ({
  id: row.id,
  caller: { environment: row.caller_env, threadId: row.caller_thread },
  subject: row.subject,
  kind: row.kind,
  key: row.key,
  urgent: row.urgent === 1,
  at: row.at,
  state: row.state,
  payload: row.payload,
});

const toDigest = (row: typeof DigestRow.Type): StoredDigest => ({
  id: row.id,
  caller: { environment: row.caller_env, threadId: row.caller_thread },
  text: row.text,
  mode: row.mode,
  createdAt: row.created_at,
});

const toReminder = (row: typeof ReminderRow.Type): StoredReminder => ({
  id: row.id,
  caller: { environment: row.caller_env, threadId: row.caller_thread },
  dueAt: row.due_at,
  text: row.text,
});

const storeError =
  (operation: string) =>
  (cause: { readonly message: string }): CompanionStoreError =>
    new CompanionStoreError({
      message: `companion store ${operation} failed`,
      operation,
      cause,
    });

export const makeCompanionStore = Effect.fn("makeCompanionStore")(function* () {
  const sql = yield* SqlClient.SqlClient;

  const version = yield* Effect.gen(function* () {
    yield* sql`PRAGMA journal_mode = WAL`;
    yield* sql`PRAGMA busy_timeout = 5000`;
    const [stored] = yield* sql<{ readonly user_version: number }>`PRAGMA user_version`;
    return stored?.user_version ?? 0;
  }).pipe(Effect.mapError(storeError("migrate")));
  if (version > schemaVersion) {
    return yield* new CompanionStoreError({
      message: `companion database has version ${version}, newer than this t3cli reads (${schemaVersion}); run the t3cli that wrote it, or move the database aside to start empty`,
      operation: "migrate",
      cause: null,
    });
  }

  yield* sql
    .withTransaction(
      Effect.gen(function* () {
        yield* sql`
          CREATE TABLE IF NOT EXISTS callers (
            env TEXT NOT NULL,
            thread TEXT NOT NULL,
            enrolled_at TEXT NOT NULL,
            cursor INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (env, thread)
          )
        `;
        yield* sql`
          CREATE TABLE IF NOT EXISTS watches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            caller_env TEXT NOT NULL,
            caller_thread TEXT NOT NULL,
            subject TEXT NOT NULL,
            origin TEXT NOT NULL,
            since TEXT NOT NULL,
            green INTEGER NOT NULL DEFAULT 0,
            memory TEXT NOT NULL,
            ended_at TEXT,
            ended_reason TEXT,
            UNIQUE (caller_env, caller_thread, subject)
          )
        `;
        yield* sql`
          CREATE TABLE IF NOT EXISTS digests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            caller_env TEXT NOT NULL,
            caller_thread TEXT NOT NULL,
            text TEXT NOT NULL,
            mode TEXT NOT NULL,
            created_at TEXT NOT NULL,
            sent_at TEXT
          )
        `;
        yield* sql`
          CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            caller_env TEXT NOT NULL,
            caller_thread TEXT NOT NULL,
            subject TEXT NOT NULL,
            kind TEXT NOT NULL,
            key TEXT NOT NULL,
            urgent INTEGER NOT NULL,
            at TEXT NOT NULL,
            state TEXT NOT NULL,
            settled_at TEXT,
            digest_id INTEGER,
            payload TEXT NOT NULL
          )
        `;
        yield* sql`CREATE INDEX IF NOT EXISTS events_state ON events (state, caller_env, caller_thread)`;
        yield* sql`
          CREATE TABLE IF NOT EXISTS reminders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            caller_env TEXT NOT NULL,
            caller_thread TEXT NOT NULL,
            due_at TEXT NOT NULL,
            text TEXT NOT NULL,
            created_at TEXT NOT NULL,
            state TEXT NOT NULL
          )
        `;
        if (version === 8) {
          // A thread with a wait pending expects to be told; as a caller it still is.
          yield* sql`
            INSERT OR IGNORE INTO callers (env, thread, enrolled_at)
            SELECT DISTINCT owner_env, owner_thread, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            FROM waits WHERE status = 'pending' AND ephemeral = 0
          `;
        }
        if (version < schemaVersion) {
          yield* sql`DROP TABLE IF EXISTS fires`;
          yield* sql`DROP TABLE IF EXISTS waits`;
          yield* sql`DROP TABLE IF EXISTS inbox`;
          yield* sql`DROP TABLE IF EXISTS subscriptions`;
          yield* sql`DROP TABLE IF EXISTS pr_checks`;
        }
        yield* sql`PRAGMA user_version = ${sql.literal(String(schemaVersion))}`;
      }),
    )
    .pipe(Effect.mapError(storeError("migrate")));

  const ownedBy = (caller: ThreadRef) =>
    sql`caller_env = ${caller.environment} AND caller_thread = ${caller.threadId}`;

  const eventColumns = sql`id, caller_env, caller_thread, subject, kind, key, urgent, at, state, payload`;

  const callers = Effect.fn("CompanionStore.callers")(
    function* () {
      const rows = yield* sql`SELECT * FROM callers ORDER BY enrolled_at`;
      return (yield* decodeCallerRows(rows)).map((row): StoredCaller => ({
        ref: { environment: row.env, threadId: row.thread },
        enrolledAt: row.enrolled_at,
        cursor: row.cursor,
      }));
    },
    Effect.mapError(storeError("callers")),
  );

  const enroll = Effect.fn("CompanionStore.enroll")(
    function* (ref: ThreadRef, at: string) {
      yield* sql`
        INSERT OR IGNORE INTO callers (env, thread, enrolled_at)
        VALUES (${ref.environment}, ${ref.threadId}, ${at})
      `;
    },
    Effect.mapError(storeError("enroll")),
  );

  const setCursor = Effect.fn("CompanionStore.setCursor")(
    function* (ref: ThreadRef, cursor: number) {
      yield* sql`
        UPDATE callers SET cursor = ${cursor}
        WHERE env = ${ref.environment} AND thread = ${ref.threadId}
      `;
    },
    Effect.mapError(storeError("setCursor")),
  );

  const removeCaller = Effect.fn("CompanionStore.removeCaller")(
    function* (ref: ThreadRef) {
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`DELETE FROM events WHERE ${ownedBy(ref)}`;
          yield* sql`DELETE FROM digests WHERE ${ownedBy(ref)}`;
          yield* sql`DELETE FROM watches WHERE ${ownedBy(ref)}`;
          yield* sql`DELETE FROM reminders WHERE ${ownedBy(ref)}`;
          yield* sql`DELETE FROM callers WHERE env = ${ref.environment} AND thread = ${ref.threadId}`;
        }),
      );
    },
    Effect.mapError(storeError("removeCaller")),
  );

  const watches = Effect.fn("CompanionStore.watches")(
    function* () {
      const rows = yield* sql`SELECT * FROM watches ORDER BY id`;
      return (yield* decodeWatchRows(rows)).map(toWatch);
    },
    Effect.mapError(storeError("watches")),
  );

  const startWatch = Effect.fn("CompanionStore.startWatch")(
    function* (input: {
      readonly caller: ThreadRef;
      readonly subject: string;
      readonly origin: WatchOrigin;
      readonly since: string;
      readonly green: boolean;
      readonly memory: WatchMemory;
    }) {
      const memory = yield* encodeMemory(input.memory);
      const rows = yield* sql`
        INSERT INTO watches (caller_env, caller_thread, subject, origin, since, green, memory)
        VALUES (
          ${input.caller.environment}, ${input.caller.threadId}, ${input.subject},
          ${input.origin}, ${input.since}, ${input.green ? 1 : 0}, ${memory}
        )
        ON CONFLICT (caller_env, caller_thread, subject) DO UPDATE SET
          origin = excluded.origin, since = excluded.since, green = excluded.green,
          memory = excluded.memory, ended_at = NULL, ended_reason = NULL
        RETURNING *
      `;
      const [row] = yield* decodeWatchRows(rows);
      if (row === undefined) {
        return yield* Effect.die("INSERT ... RETURNING produced no row");
      }
      return toWatch(row);
    },
    Effect.mapError(storeError("startWatch")),
  );

  const endWatch = Effect.fn("CompanionStore.endWatch")(
    function* (id: number, reason: string, at: string) {
      yield* sql`UPDATE watches SET ended_at = ${at}, ended_reason = ${reason} WHERE id = ${id}`;
    },
    Effect.mapError(storeError("endWatch")),
  );

  const setGreen = Effect.fn("CompanionStore.setGreen")(
    function* (id: number, green: boolean) {
      yield* sql`UPDATE watches SET green = ${green ? 1 : 0} WHERE id = ${id}`;
    },
    Effect.mapError(storeError("setGreen")),
  );

  const insertEvent = Effect.fn("CompanionStore.insertEvent")(function* (event: NewEvent) {
    const rows = yield* sql`
      INSERT INTO events (caller_env, caller_thread, subject, kind, key, urgent, at, state, payload)
      VALUES (
        ${event.caller.environment}, ${event.caller.threadId}, ${event.subject}, ${event.kind},
        ${event.key}, ${event.urgent ? 1 : 0}, ${event.at}, 'pending',
        ${yield* encodePayload(event.payload)}
      )
      RETURNING ${eventColumns}
    `;
    const [row] = yield* decodeEventRows(rows);
    if (row === undefined) {
      return yield* Effect.die("INSERT ... RETURNING produced no row");
    }
    return toEvent(row);
  });

  const emit = Effect.fn("CompanionStore.emit")(
    function* (
      watch: { readonly id: number; readonly memory: WatchMemory } | null,
      events: ReadonlyArray<NewEvent>,
    ) {
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          if (watch !== null) {
            yield* sql`
              UPDATE watches SET memory = ${yield* encodeMemory(watch.memory)} WHERE id = ${watch.id}
            `;
          }
          return yield* Effect.forEach(events, insertEvent);
        }),
      );
    },
    Effect.mapError(storeError("emit")),
  );

  const pendingEvents = Effect.fn("CompanionStore.pendingEvents")(
    function* (caller: ThreadRef | null) {
      const rows = yield* sql`
        SELECT ${eventColumns} FROM events
        WHERE state = 'pending' AND digest_id IS NULL
          AND ${caller === null ? sql`1 = 1` : ownedBy(caller)}
        ORDER BY id
      `;
      return (yield* decodeEventRows(rows)).map(toEvent);
    },
    Effect.mapError(storeError("pendingEvents")),
  );

  const event = Effect.fn("CompanionStore.event")(
    function* (caller: ThreadRef, id: number) {
      const rows = yield* sql`
        SELECT ${eventColumns} FROM events WHERE id = ${id} AND ${ownedBy(caller)}
      `;
      const [row] = yield* decodeEventRows(rows);
      return row === undefined ? null : toEvent(row);
    },
    Effect.mapError(storeError("event")),
  );

  const settle = Effect.fn("CompanionStore.settle")(
    function* (ids: ReadonlyArray<number>, state: "taken" | "dropped", at: string) {
      if (ids.length > 0) {
        yield* sql`
          UPDATE events SET state = ${state}, settled_at = ${at}
          WHERE state = 'pending' AND digest_id IS NULL AND ${sql.in("id", ids)}
        `;
      }
    },
    Effect.mapError(storeError("settle")),
  );

  const dropSubject = Effect.fn("CompanionStore.dropSubject")(
    function* (caller: ThreadRef, subject: string, at: string) {
      yield* sql`
        UPDATE events SET state = 'dropped', settled_at = ${at}
        WHERE state = 'pending' AND digest_id IS NULL AND subject = ${subject} AND ${ownedBy(caller)}
      `;
    },
    Effect.mapError(storeError("dropSubject")),
  );

  const openDigest = Effect.fn("CompanionStore.openDigest")(
    function* (input: {
      readonly caller: ThreadRef;
      /** The digest's text, which names its id. */
      readonly text: (id: number) => string;
      readonly mode: "auto" | "steer";
      readonly at: string;
      readonly eventIds: ReadonlyArray<number>;
    }) {
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const rows = yield* sql`
            INSERT INTO digests (caller_env, caller_thread, text, mode, created_at)
            VALUES (
              ${input.caller.environment}, ${input.caller.threadId}, '', ${input.mode}, ${input.at}
            )
            RETURNING id, caller_env, caller_thread, text, mode, created_at
          `;
          const [row] = yield* decodeDigestRows(rows);
          if (row === undefined) {
            return yield* Effect.die("INSERT ... RETURNING produced no row");
          }
          const text = input.text(row.id);
          yield* sql`UPDATE digests SET text = ${text} WHERE id = ${row.id}`;
          yield* sql`
            UPDATE events SET digest_id = ${row.id}
            WHERE state = 'pending' AND digest_id IS NULL AND ${sql.in("id", input.eventIds)}
          `;
          return { ...toDigest(row), text };
        }),
      );
    },
    Effect.mapError(storeError("openDigest")),
  );

  const closeDigest = Effect.fn("CompanionStore.closeDigest")(
    function* (id: number, at: string) {
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`UPDATE digests SET sent_at = ${at} WHERE id = ${id}`;
          yield* sql`
            UPDATE events SET state = 'delivered', settled_at = ${at}
            WHERE digest_id = ${id} AND state = 'pending'
          `;
        }),
      );
    },
    Effect.mapError(storeError("closeDigest")),
  );

  const abandonDigest = Effect.fn("CompanionStore.abandonDigest")(
    function* (id: number) {
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`UPDATE events SET digest_id = NULL WHERE digest_id = ${id} AND state = 'pending'`;
          yield* sql`DELETE FROM digests WHERE id = ${id}`;
        }),
      );
    },
    Effect.mapError(storeError("abandonDigest")),
  );

  const openDigests = Effect.fn("CompanionStore.openDigests")(
    function* () {
      const rows = yield* sql`
        SELECT id, caller_env, caller_thread, text, mode, created_at
        FROM digests WHERE sent_at IS NULL ORDER BY id
      `;
      return (yield* decodeDigestRows(rows)).map(toDigest);
    },
    Effect.mapError(storeError("openDigests")),
  );

  const addReminder = Effect.fn("CompanionStore.addReminder")(
    function* (input: {
      readonly caller: ThreadRef;
      readonly dueAt: string;
      readonly text: string;
      readonly at: string;
    }) {
      const rows = yield* sql`
        INSERT INTO reminders (caller_env, caller_thread, due_at, text, created_at, state)
        VALUES (
          ${input.caller.environment}, ${input.caller.threadId}, ${input.dueAt}, ${input.text},
          ${input.at}, 'pending'
        )
        RETURNING id, caller_env, caller_thread, due_at, text
      `;
      const [row] = yield* decodeReminderRows(rows);
      if (row === undefined) {
        return yield* Effect.die("INSERT ... RETURNING produced no row");
      }
      return toReminder(row);
    },
    Effect.mapError(storeError("addReminder")),
  );

  const reminders = Effect.fn("CompanionStore.reminders")(
    function* () {
      const rows = yield* sql`
        SELECT id, caller_env, caller_thread, due_at, text
        FROM reminders WHERE state = 'pending' ORDER BY due_at
      `;
      return (yield* decodeReminderRows(rows)).map(toReminder);
    },
    Effect.mapError(storeError("reminders")),
  );

  const cancelReminder = Effect.fn("CompanionStore.cancelReminder")(
    function* (caller: ThreadRef, id: number) {
      const rows = yield* sql`
        UPDATE reminders SET state = 'cancelled'
        WHERE id = ${id} AND state = 'pending' AND ${ownedBy(caller)}
        RETURNING id
      `;
      return rows.length > 0;
    },
    Effect.mapError(storeError("cancelReminder")),
  );

  const fireReminder = Effect.fn("CompanionStore.fireReminder")(
    function* (id: number, reminderEvent: NewEvent) {
      yield* sql.withTransaction(
        Effect.gen(function* () {
          const rows = yield* sql`
            UPDATE reminders SET state = 'fired' WHERE id = ${id} AND state = 'pending' RETURNING id
          `;
          if (rows.length > 0) {
            yield* insertEvent(reminderEvent);
          }
        }),
      );
    },
    Effect.mapError(storeError("fireReminder")),
  );

  const prune = Effect.fn("CompanionStore.prune")(
    function* (before: string) {
      yield* sql`DELETE FROM events WHERE state <> 'pending' AND settled_at < ${before}`;
      yield* sql`DELETE FROM digests WHERE sent_at IS NOT NULL AND sent_at < ${before}`;
      yield* sql`DELETE FROM reminders WHERE state <> 'pending' AND due_at < ${before}`;
    },
    Effect.mapError(storeError("prune")),
  );

  return CompanionStore.of({
    callers,
    enroll,
    setCursor,
    removeCaller,
    watches,
    startWatch,
    endWatch,
    setGreen,
    emit,
    pendingEvents,
    event,
    settle,
    dropSubject,
    openDigest,
    closeDigest,
    abandonDigest,
    openDigests,
    addReminder,
    reminders,
    cancelReminder,
    fireReminder,
    prune,
  });
});

export const CompanionStoreLive = Layer.effect(CompanionStore, makeCompanionStore());
