import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { SqlClientFactory } from "./service.ts";

export const NodeSqlClientFactoryLive = Layer.succeed(
  SqlClientFactory,
  SqlClientFactory.of({
    sqliteClient: (config) =>
      Layer.build(NodeSqliteClient.layer(config)).pipe(
        Effect.map(Context.get(SqlClient.SqlClient)),
      ),
  }),
);
