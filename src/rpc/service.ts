import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type { RpcClient, RpcClientError } from "effect/unstable/rpc";

import type { WsRpcGroup } from "../protocol/schema.ts";
import type { RpcError } from "./error.ts";

export type WsClient = RpcClient.FromGroup<typeof WsRpcGroup, RpcClientError.RpcClientError>;

export type T3RpcService = {
  readonly getClient: Effect.Effect<WsClient, RpcError>;
  readonly reconnect: Effect.Effect<WsClient, RpcError>;
  readonly disconnect: Effect.Effect<void>;
};

export class T3Rpc extends Context.Service<T3Rpc, T3RpcService>()("t3cli/T3Rpc") {}
