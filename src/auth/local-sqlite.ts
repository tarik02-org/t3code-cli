import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";

import { AuthLocalDatabaseError } from "./error.ts";

export type LocalAuthSqliteColumn = {
  readonly name: string;
};

export type LocalAuthSqliteShape = {
  readonly execute: (sql: string) => Effect.Effect<void, AuthLocalDatabaseError>;
  readonly run: (
    sql: string,
    params: ReadonlyArray<SQLInputValue>,
  ) => Effect.Effect<void, AuthLocalDatabaseError>;
  readonly tableInfo: (
    tableName: "auth_sessions",
  ) => Effect.Effect<ReadonlyArray<LocalAuthSqliteColumn>, AuthLocalDatabaseError>;
};

export class LocalAuthSqlite extends Context.Service<LocalAuthSqlite, LocalAuthSqliteShape>()(
  "t3cli/LocalAuthSqlite",
) {}

export type LocalAuthSqliteConfig = {
  readonly filename: string;
};

export const makeLocalAuthSqlite = Effect.fn("makeLocalAuthSqlite")(function* (
  config: LocalAuthSqliteConfig,
) {
  const scope = yield* Effect.scope;
  const db = yield* Effect.try({
    try: () => new DatabaseSync(config.filename),
    catch: (error) =>
      new AuthLocalDatabaseError({
        operation: "connect",
        message: sqliteErrorMessage(error),
      }),
  });
  yield* Scope.addFinalizer(
    scope,
    Effect.sync(() => {
      try {
        db.close();
      } catch {
        // Ignore close failures after the owning effect already produced its result.
      }
    }),
  );

  const execute = Effect.fn("LocalAuthSqlite.execute")((sql: string) =>
    Effect.try({
      try: () => db.exec(sql),
      catch: (error) =>
        new AuthLocalDatabaseError({
          operation: "query",
          message: sqliteErrorMessage(error),
        }),
    }),
  );

  const run = Effect.fn("LocalAuthSqlite.run")(
    (sql: string, params: ReadonlyArray<SQLInputValue>) =>
      Effect.try({
        try: () => db.prepare(sql).run(...params),
        catch: (error) =>
          new AuthLocalDatabaseError({
            operation: "query",
            message: sqliteErrorMessage(error),
          }),
      }).pipe(Effect.asVoid),
  );

  const tableInfo = Effect.fn("LocalAuthSqlite.tableInfo")((tableName: "auth_sessions") =>
    Effect.try({
      try: () => db.prepare(`PRAGMA table_info(${tableName})`).all(),
      catch: (error) =>
        new AuthLocalDatabaseError({
          operation: "query",
          message: sqliteErrorMessage(error),
        }),
    }).pipe(
      Effect.flatMap((rows) => {
        const columns = rows.flatMap((row) =>
          typeof row["name"] === "string" ? [{ name: row["name"] }] : [],
        );
        if (columns.length !== rows.length) {
          return Effect.fail(
            new AuthLocalDatabaseError({
              operation: "schema",
              message: `local auth database returned invalid ${tableName} table info`,
            }),
          );
        }
        return Effect.succeed(columns);
      }),
    ),
  );

  return {
    execute,
    run,
    tableInfo,
  };
});

export const LocalAuthSqliteLive = (config: LocalAuthSqliteConfig) =>
  Layer.effect(LocalAuthSqlite, makeLocalAuthSqlite(config));

function sqliteErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "sqlite operation failed";
}
