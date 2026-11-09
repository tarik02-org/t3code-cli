import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { T3RpcOperations, T3RpcOperationsLive } from "../rpc/operation.ts";
import { T3Rpc } from "../rpc/service.ts";
import { T3CodeRpcLayer } from "./layer.ts";
import { T3PreparedConnectionProvider, T3PreparedConnectionProviderLive } from "./prepared.ts";
import { T3CodeConnectionProvider, makeT3CodeConnectionProvider } from "./service.ts";

/**
 * Builds the services for one environment inside the caller's scope, for hosts that talk to
 * several environments at once. `get` runs on every (re)connect, so it can return a rotated token.
 */
export const makeT3CodeClient = Effect.fn("makeT3CodeClient")(function* (
  get: T3CodeConnectionProvider["Service"]["get"],
) {
  const context = yield* Layer.build(
    T3RpcOperationsLive.pipe(
      Layer.provideMerge(Layer.mergeAll(T3CodeRpcLayer, T3PreparedConnectionProviderLive)),
      Layer.provide(Layer.succeed(T3CodeConnectionProvider, makeT3CodeConnectionProvider(get))),
    ),
  );
  return {
    rpc: Context.get(context, T3Rpc),
    operations: Context.get(context, T3RpcOperations),
    preparedConnection: Context.get(context, T3PreparedConnectionProvider),
  };
});

export type T3CodeClient = Effect.Success<ReturnType<typeof makeT3CodeClient>>;
