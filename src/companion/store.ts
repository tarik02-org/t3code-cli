import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import type { Baselines } from "./condition.ts";
import { CompanionStoreError } from "./error.ts";
import { Condition, type ThreadRef, type Wait, WaitResult, WakePolicy } from "./schema.ts";

const BaselinesJson = Schema.fromJsonString(
  Schema.Struct({
    sinceMs: Schema.Number,
    messages: Schema.Record(Schema.String, Schema.NullOr(Schema.String)),
    heads: Schema.Record(Schema.String, Schema.String),
  }),
);

const WaitRow = Schema.Struct({
  id: Schema.Number,
  owner_env: Schema.String,
  owner_thread: Schema.String,
  label: Schema.NullOr(Schema.String),
  condition: Schema.fromJsonString(Condition),
  wake: WakePolicy,
  repeat: Schema.Number,
  ephemeral: Schema.Number,
  deadline_at: Schema.NullOr(Schema.String),
  created_at: Schema.String,
  baselines: BaselinesJson,
  status: Schema.Literals(["pending", "fired", "timeout", "cancelled"]),
  armed: Schema.Number,
});
const decodeWaitRows = Schema.decodeUnknownEffect(Schema.Array(WaitRow));

const FireRow = Schema.Struct({
  ...WaitRow.fields,
  fire_id: Schema.Number,
  summary: Schema.String,
  result: Schema.fromJsonString(WaitResult),
});
const decodeFireRows = Schema.decodeUnknownEffect(Schema.Array(FireRow));

const encodeCondition = Schema.encodeEffect(Schema.fromJsonString(Condition));
const encodeBaselines = Schema.encodeEffect(BaselinesJson);
const encodeResult = Schema.encodeEffect(Schema.fromJsonString(WaitResult));

/** Schema version, kept in `PRAGMA user_version`. Earlier versions held subscriptions and an inbox. */
const schemaVersion = 8;

/** A wait with what only the daemon needs to follow it. */
export interface StoredWait extends Wait {
  readonly baselines: Baselines;
  /** A repeating wait that fired is disarmed until its condition has been false again. */
  readonly armed: boolean;
  /** Belongs to one blocking call and is removed with it. */
  readonly ephemeral: boolean;
}

/** One firing of a wait, with the wait it belongs to. */
export interface StoredFire {
  readonly fireId: number;
  readonly wait: StoredWait;
  readonly summary: string;
  readonly result: WaitResult;
}

export interface NewWait {
  readonly owner: ThreadRef;
  readonly label: string | null;
  readonly condition: Condition;
  readonly wake: WakePolicy;
  readonly repeat: boolean;
  readonly ephemeral: boolean;
  readonly deadlineAt: string | null;
  readonly createdAt: string;
  readonly baselines: Baselines;
}

export class CompanionStore extends Context.Service<
  CompanionStore,
  {
    readonly createWait: (input: NewWait) => Effect.Effect<StoredWait, CompanionStoreError>;
    readonly pendingWaits: () => Effect.Effect<ReadonlyArray<StoredWait>, CompanionStoreError>;
    readonly updateWait: (
      id: number,
      patch: {
        readonly status?: Wait["status"];
        readonly armed?: boolean;
        readonly baselines?: Baselines;
      },
    ) => Effect.Effect<void, CompanionStoreError>;
    readonly recordFire: (input: {
      readonly waitId: number;
      readonly at: string;
      readonly summary: string;
      readonly result: WaitResult;
    }) => Effect.Effect<number, CompanionStoreError>;
    /**
     * Firings not handed to their owner yet: the ones a wake message carries (`woken`), or the
     * ones of waits that wake nobody (`silent`). Every owner's when `owner` is null.
     */
    readonly undelivered: (
      owner: ThreadRef | null,
      kind: "woken" | "silent",
    ) => Effect.Effect<ReadonlyArray<StoredFire>, CompanionStoreError>;
    readonly markDelivered: (
      fireIds: ReadonlyArray<number>,
      at: string,
    ) => Effect.Effect<void, CompanionStoreError>;
    /** The owner's wait's last firing, if it fired. */
    readonly latestFire: (
      owner: ThreadRef,
      waitId: number,
    ) => Effect.Effect<StoredFire | null, CompanionStoreError>;
    /** Removes a wait and its firings. */
    readonly removeWait: (id: number) => Effect.Effect<void, CompanionStoreError>;
    /** Removes finished waits that were made, and last fired, before `before`. */
    readonly prune: (before: string) => Effect.Effect<void, CompanionStoreError>;
  }
>()("t3cli/companion/CompanionStore") {}

const toWait = (row: typeof WaitRow.Type): StoredWait => ({
  id: row.id,
  owner: { environment: row.owner_env, threadId: row.owner_thread },
  label: row.label,
  condition: row.condition,
  wake: row.wake,
  repeat: row.repeat === 1,
  deadlineAt: row.deadline_at,
  createdAt: row.created_at,
  status: row.status,
  baselines: row.baselines,
  armed: row.armed === 1,
  ephemeral: row.ephemeral === 1,
});

const toFire = (row: typeof FireRow.Type): StoredFire => ({
  fireId: row.fire_id,
  wait: toWait(row),
  summary: row.summary,
  result: row.result,
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
        if (version < schemaVersion) {
          // Subscriptions and inbox items have no meaning as waits; nothing is carried over.
          yield* sql`DROP TABLE IF EXISTS inbox`;
          yield* sql`DROP TABLE IF EXISTS subscriptions`;
          yield* sql`DROP TABLE IF EXISTS pr_checks`;
        }
        yield* sql`
          CREATE TABLE IF NOT EXISTS waits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_env TEXT NOT NULL,
            owner_thread TEXT NOT NULL,
            label TEXT,
            condition TEXT NOT NULL,
            wake TEXT NOT NULL,
            repeat INTEGER NOT NULL,
            ephemeral INTEGER NOT NULL,
            deadline_at TEXT,
            created_at TEXT NOT NULL,
            baselines TEXT NOT NULL,
            status TEXT NOT NULL,
            armed INTEGER NOT NULL DEFAULT 1
          )
        `;
        yield* sql`
          CREATE TABLE IF NOT EXISTS fires (
            fire_id INTEGER PRIMARY KEY AUTOINCREMENT,
            wait_id INTEGER NOT NULL,
            at TEXT NOT NULL,
            summary TEXT NOT NULL,
            result TEXT NOT NULL,
            delivered_at TEXT
          )
        `;
        yield* sql`CREATE INDEX IF NOT EXISTS fires_wait ON fires (wait_id, fire_id)`;
        yield* sql`PRAGMA user_version = ${sql.literal(String(schemaVersion))}`;
      }),
    )
    .pipe(Effect.mapError(storeError("migrate")));

  const ownedBy = (owner: ThreadRef) =>
    sql`waits.owner_env = ${owner.environment} AND waits.owner_thread = ${owner.threadId}`;

  const createWait = Effect.fn("CompanionStore.createWait")(
    function* (input: NewWait) {
      const rows = yield* sql`
        INSERT INTO waits
          (owner_env, owner_thread, label, condition, wake, repeat, ephemeral, deadline_at,
           created_at, baselines, status)
        VALUES (
          ${input.owner.environment},
          ${input.owner.threadId},
          ${input.label},
          ${yield* encodeCondition(input.condition)},
          ${input.wake},
          ${input.repeat ? 1 : 0},
          ${input.ephemeral ? 1 : 0},
          ${input.deadlineAt},
          ${input.createdAt},
          ${yield* encodeBaselines(input.baselines)},
          'pending'
        )
        RETURNING *
      `;
      const [row] = yield* decodeWaitRows(rows);
      if (row === undefined) {
        return yield* Effect.die("INSERT ... RETURNING produced no row");
      }
      return toWait(row);
    },
    Effect.mapError(storeError("createWait")),
  );

  const pendingWaits = Effect.fn("CompanionStore.pendingWaits")(
    function* () {
      const rows = yield* sql`SELECT * FROM waits WHERE status = 'pending' ORDER BY id`;
      return (yield* decodeWaitRows(rows)).map(toWait);
    },
    Effect.mapError(storeError("pendingWaits")),
  );

  const updateWait = Effect.fn("CompanionStore.updateWait")(
    function* (
      id: number,
      patch: {
        readonly status?: Wait["status"];
        readonly armed?: boolean;
        readonly baselines?: Baselines;
      },
    ) {
      if (patch.status !== undefined) {
        yield* sql`UPDATE waits SET status = ${patch.status} WHERE id = ${id}`;
      }
      if (patch.armed !== undefined) {
        yield* sql`UPDATE waits SET armed = ${patch.armed ? 1 : 0} WHERE id = ${id}`;
      }
      if (patch.baselines !== undefined) {
        yield* sql`
          UPDATE waits SET baselines = ${yield* encodeBaselines(patch.baselines)} WHERE id = ${id}
        `;
      }
    },
    Effect.mapError(storeError("updateWait")),
  );

  const recordFire = Effect.fn("CompanionStore.recordFire")(
    function* (input: {
      readonly waitId: number;
      readonly at: string;
      readonly summary: string;
      readonly result: WaitResult;
    }) {
      const rows = yield* sql<{ readonly fire_id: number }>`
        INSERT INTO fires (wait_id, at, summary, result)
        VALUES (${input.waitId}, ${input.at}, ${input.summary}, ${yield* encodeResult(input.result)})
        RETURNING fire_id
      `;
      const [row] = rows;
      if (row === undefined) {
        return yield* Effect.die("INSERT ... RETURNING produced no row");
      }
      return row.fire_id;
    },
    Effect.mapError(storeError("recordFire")),
  );

  const undelivered = Effect.fn("CompanionStore.undelivered")(
    function* (owner: ThreadRef | null, kind: "woken" | "silent") {
      const rows = yield* sql`
        SELECT waits.*, fires.fire_id, fires.summary, fires.result
        FROM fires JOIN waits ON waits.id = fires.wait_id
        WHERE fires.delivered_at IS NULL
          AND waits.ephemeral = 0
          AND ${kind === "silent" ? sql`waits.wake = 'none'` : sql`waits.wake <> 'none'`}
          AND ${owner === null ? sql`1 = 1` : ownedBy(owner)}
        ORDER BY fires.fire_id
      `;
      return (yield* decodeFireRows(rows)).map(toFire);
    },
    Effect.mapError(storeError("undelivered")),
  );

  const markDelivered = Effect.fn("CompanionStore.markDelivered")(
    function* (fireIds: ReadonlyArray<number>, at: string) {
      if (fireIds.length > 0) {
        yield* sql`UPDATE fires SET delivered_at = ${at} WHERE ${sql.in("fire_id", fireIds)}`;
      }
    },
    Effect.mapError(storeError("markDelivered")),
  );

  const latestFire = Effect.fn("CompanionStore.latestFire")(
    function* (owner: ThreadRef, waitId: number) {
      const rows = yield* sql`
        SELECT waits.*, fires.fire_id, fires.summary, fires.result
        FROM fires JOIN waits ON waits.id = fires.wait_id
        WHERE waits.id = ${waitId} AND ${ownedBy(owner)}
        ORDER BY fires.fire_id DESC
        LIMIT 1
      `;
      const [row] = yield* decodeFireRows(rows);
      return row === undefined ? null : toFire(row);
    },
    Effect.mapError(storeError("latestFire")),
  );

  const removeWait = Effect.fn("CompanionStore.removeWait")(
    function* (id: number) {
      yield* sql`DELETE FROM fires WHERE wait_id = ${id}`;
      yield* sql`DELETE FROM waits WHERE id = ${id}`;
    },
    Effect.mapError(storeError("removeWait")),
  );

  const prune = Effect.fn("CompanionStore.prune")(
    function* (before: string) {
      yield* sql`
        DELETE FROM waits
        WHERE status <> 'pending' AND created_at < ${before}
          AND NOT EXISTS (SELECT 1 FROM fires WHERE wait_id = waits.id AND at >= ${before})
      `;
      yield* sql`
        DELETE FROM fires
        WHERE NOT EXISTS (SELECT 1 FROM waits WHERE id = fires.wait_id)
          OR (at < ${before} AND delivered_at IS NOT NULL)
      `;
    },
    Effect.mapError(storeError("prune")),
  );

  return CompanionStore.of({
    createWait,
    pendingWaits,
    updateWait,
    recordFire,
    undelivered,
    markDelivered,
    latestFire,
    removeWait,
    prune,
  });
});

export const CompanionStoreLive = Layer.effect(CompanionStore, makeCompanionStore());
