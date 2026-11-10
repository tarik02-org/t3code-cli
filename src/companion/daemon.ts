import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";
import * as HttpRouter from "effect/http/HttpRouter";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as RpcServer from "effect/rpc/RpcServer";

import { resolveConfigFilePath } from "../config/paths/paths.ts";
import { SqlClientFactory } from "../sql/service.ts";
import {
  CompanionEnvironments,
  CompanionEnvironmentsLive,
  type ConnectEnvironment,
  type MakeAgentSender,
} from "./environments.ts";
import { CompanionStoreError } from "./error.ts";
import { CompanionHub, CompanionHubLive, maxWaitSeconds } from "./hub.ts";
import { CompanionMcpLive, companionMcpPath } from "./mcp.ts";
import { resolveCompanionPaths } from "./paths.ts";
import { CompanionRpcs, companionRpcPath } from "./rpc.ts";
import { CompanionRuntimeFile } from "./schema.ts";
import { CompanionStoreLive } from "./store.ts";
import { runCompanionWatcher } from "./watcher.ts";

const encodeRuntimeFile = Schema.encodeEffect(Schema.fromJsonString(CompanionRuntimeFile));

export interface CompanionDaemonOptions {
  readonly port: number;
  readonly pid: number;
  readonly version: string;
  readonly environments: ReadonlyArray<string>;
}

/**
 * Runs the companion until `POST /shutdown` or interruption. The entry point provides the
 * `HttpServer` that listens on `options.port`, so this module stays platform-neutral.
 */
export const runCompanionDaemon = Effect.fn("runCompanionDaemon")(function* <E, R, RA>(
  options: CompanionDaemonOptions,
  connect: ConnectEnvironment<E, R>,
  makeAgentSender: MakeAgentSender<RA>,
) {
  const fs = yield* FileSystem.FileSystem;
  const paths = yield* resolveCompanionPaths();
  yield* fs.makeDirectory(paths.stateDir, { recursive: true });
  const sql = yield* (yield* SqlClientFactory).sqliteClient({ filename: paths.database }).pipe(
    Effect.mapError(
      (cause) =>
        new CompanionStoreError({
          message: `failed to open ${paths.database}`,
          operation: "open",
          cause,
        }),
    ),
  );
  const startedAt = DateTime.formatIso(yield* DateTime.now);
  const url = `http://127.0.0.1:${options.port}`;
  const shutdown = yield* Deferred.make<void>();

  const core = CompanionHubLive.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        CompanionStoreLive,
        CompanionEnvironmentsLive(connect, makeAgentSender, options.environments),
      ),
    ),
    Layer.provide(Layer.succeed(SqlClient.SqlClient, sql)),
  );

  const rpcHandlers = CompanionRpcs.toLayer(
    Effect.gen(function* () {
      const environments = yield* CompanionEnvironments;
      const hub = yield* CompanionHub;
      return CompanionRpcs.of({
        health: () =>
          environments.statuses.pipe(
            Effect.map((statuses) => ({
              pid: options.pid,
              startedAt,
              mcpUrl: `${url}${companionMcpPath}`,
              database: paths.database,
              environments: statuses,
            })),
          ),
        shutdown: () => Deferred.succeed(shutdown, undefined).pipe(Effect.asVoid),
        subscribe: (input) => hub.subscribe(input),
        arm: (input) => hub.arm(input),
        unsubscribe: (input) => hub.unsubscribe(input),
        subscriptions: (input) => hub.listSubscriptions(input.subscriber),
        inbox: (input) => hub.listInbox(input),
        resolve: (input) => hub.resolve(input),
        snooze: (input) => hub.snooze(input),
        wait: (input) =>
          hub.wait({
            subscriber: input.subscriber,
            afterId: input.afterId,
            kinds: input.events,
            timeout: Duration.seconds(Math.min(Math.max(input.timeoutSeconds, 0), maxWaitSeconds)),
          }),
        openWork: (input) => hub.openWork(input.subscriber),
      });
    }),
  );

  const rpcRoutes = RpcServer.layerHttp({
    group: CompanionRpcs,
    path: companionRpcPath,
    protocol: "http",
  }).pipe(Layer.provide(rpcHandlers), Layer.provide(RpcSerialization.layerNdjson));

  const services = yield* Layer.build(
    HttpRouter.serve(Layer.mergeAll(CompanionMcpLive(options.version), rpcRoutes), {
      disableLogger: true,
    }).pipe(Layer.provideMerge(core)),
  );
  const hub = Context.get(services, CompanionHub);

  yield* hub.flushPendingWakes;
  yield* Effect.forkScoped(runCompanionWatcher().pipe(Effect.provide(services)));
  yield* Effect.forkScoped(hub.runSnoozes);

  // `t3cli env` and `auth` rewrite the config file; pick up added and removed environments.
  const path = yield* Path.Path;
  const environments = Context.get(services, CompanionEnvironments);
  const configFile = yield* resolveConfigFilePath();
  yield* fs.watch(path.dirname(configFile)).pipe(
    Stream.filter((event) => path.basename(event.path) === path.basename(configFile)),
    Stream.debounce(Duration.seconds(1)),
    Stream.runForEach(() =>
      environments.reload.pipe(
        Effect.catchCause((cause) => Effect.logWarning("failed to reload environments", cause)),
      ),
    ),
    Effect.catchCause((cause) => Effect.logWarning("stopped watching the t3cli config", cause)),
    Effect.forkScoped,
  );

  yield* fs.writeFileString(
    paths.runtimeFile,
    yield* encodeRuntimeFile({ pid: options.pid, port: options.port, url, startedAt }),
  );
  yield* Effect.addFinalizer(() =>
    fs
      .remove(paths.runtimeFile)
      .pipe(
        Effect.catchCause((cause) => Effect.logWarning("failed to remove runtime file", cause)),
      ),
  );
  yield* Effect.logInfo(`companion listening on ${url}${companionMcpPath} (db ${paths.database})`);
  yield* Deferred.await(shutdown);
  yield* Effect.logInfo("companion shutting down");
}, Effect.scoped);
