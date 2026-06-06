import type * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import type * as Scope from "effect/Scope";
import type * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

export type SqliteClientConfig = {
  readonly filename: string;
  readonly transformResultNames?: ((str: string) => string) | undefined;
  readonly transformQueryNames?: ((str: string) => string) | undefined;
};

export type SqlClientFactoryShape = {
  readonly withSqliteClient: <A, E, R>(
    config: SqliteClientConfig,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | SqlError, Exclude<Exclude<R, SqlClient.SqlClient>, Scope.Scope>>;
};

export class SqlClientFactory extends Context.Service<SqlClientFactory, SqlClientFactoryShape>()(
  "t3cli/SqlClientFactory",
) {}
