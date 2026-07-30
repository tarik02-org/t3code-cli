import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type { RpcClient, RpcClientError } from "effect/unstable/rpc";

import type { RpcError } from "./error.ts";
import type { CliWsRpcGroup } from "./ws-group.ts";

export type WsClient = RpcClient.FromGroup<typeof CliWsRpcGroup, RpcClientError.RpcClientError>;

export type T3RpcService = {
  readonly getClient: Effect.Effect<WsClient, RpcError>;
  readonly reconnect: Effect.Effect<WsClient, RpcError>;
  readonly disconnect: Effect.Effect<void>;
};

export class T3Rpc extends Context.Service<T3Rpc, T3RpcService>()("t3cli/T3Rpc") {}
