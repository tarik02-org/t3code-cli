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
  readonly sqliteClient: (
    config: SqliteClientConfig,
  ) => Effect.Effect<SqlClient.SqlClient, SqlError, Scope.Scope>;
};

export class SqlClientFactory extends Context.Service<SqlClientFactory, SqlClientFactoryShape>()(
  "t3cli/SqlClientFactory",
) {}
