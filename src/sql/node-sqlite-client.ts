import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { identity } from "effect/Function";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { Connection } from "effect/unstable/sql/SqlConnection";
import { classifySqliteError, SqlError } from "effect/unstable/sql/SqlError";
import * as Statement from "effect/unstable/sql/Statement";

import { SqlClientFactory, type SqliteClientConfig } from "./service.ts";

const ATTR_DB_SYSTEM_NAME = "db.system.name";

const classifyError = (cause: unknown, message: string, operation: string) =>
  classifySqliteError(cause, { message, operation });

export const makeNodeSqliteClient = Effect.fn("makeNodeSqliteClient")(function* (
  config: SqliteClientConfig,
) {
  const compiler = Statement.makeCompilerSqlite(config.transformQueryNames);
  const transformRows =
    config.transformResultNames === undefined
      ? undefined
      : Statement.defaultTransforms(config.transformResultNames).array;
  const scope = yield* Effect.scope;
  const db = yield* Effect.try({
    try: () => new DatabaseSync(config.filename),
    catch: (cause) =>
      new SqlError({
        reason: classifyError(cause, "Failed to open sqlite database", "connect"),
      }),
  });
  yield* Scope.addFinalizer(
    scope,
    Effect.sync(() => {
      try {
        db.close();
      } catch {
        // Ignore close failures after the scoped client is done.
      }
    }),
  );

  const runRows = (sql: string, params: ReadonlyArray<unknown>) =>
    Effect.try({
      try: () => {
        const statement = db.prepare(sql);
        const bound = params.map(toSqlInputValue);
        if (statement.columns().length > 0) {
          return statement.all(...bound);
        }
        statement.run(...bound);
        return [];
      },
      catch: (cause) =>
        new SqlError({
          reason: classifyError(cause, "Failed to execute sqlite statement", "execute"),
        }),
    });

  const runRaw = (sql: string, params: ReadonlyArray<unknown>) =>
    Effect.try({
      try: () => {
        const statement = db.prepare(sql);
        const bound = params.map(toSqlInputValue);
        return statement.columns().length > 0 ? statement.all(...bound) : statement.run(...bound);
      },
      catch: (cause) =>
        new SqlError({
          reason: classifyError(cause, "Failed to execute sqlite statement", "execute"),
        }),
    });

  const runValues = (sql: string, params: ReadonlyArray<unknown>) =>
    Effect.map(runRows(sql, params), (rows) =>
      rows.map((row) => Object.values(row as Record<string, unknown>)),
    );

  const connection = identity<Connection>({
    execute(sql, params, rowTransform) {
      const effect = runRows(sql, params);
      return rowTransform === undefined ? effect : Effect.map(effect, rowTransform);
    },
    executeRaw(sql, params) {
      return runRaw(sql, params);
    },
    executeValues(sql, params) {
      return runValues(sql, params);
    },
    executeUnprepared(sql, params, rowTransform) {
      const effect = runRows(sql, params);
      return rowTransform === undefined ? effect : Effect.map(effect, rowTransform);
    },
    executeStream(sql, params, rowTransform) {
      return Stream.fromIterableEffect(this.execute(sql, params, rowTransform));
    },
  });

  const acquirer = Effect.succeed(connection);
  return yield* SqlClient.make({
    acquirer,
    compiler,
    spanAttributes: [[ATTR_DB_SYSTEM_NAME, "sqlite"]],
    transformRows,
  });
});

export const NodeSqliteClientLive = (config: SqliteClientConfig) =>
  Layer.effectContext(
    Effect.map(makeNodeSqliteClient(config), (client) => Context.make(SqlClient.SqlClient, client)),
  ).pipe(Layer.provide(Reactivity.layer));

export const NodeSqlClientFactoryLive = Layer.succeed(SqlClientFactory, {
  sqliteClient: (config) => makeNodeSqliteClient(config).pipe(Effect.provide(Reactivity.layer)),
});

function toSqlInputValue(value: unknown): SQLInputValue {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy;
  }
  return JSON.stringify(value) ?? null;
}
