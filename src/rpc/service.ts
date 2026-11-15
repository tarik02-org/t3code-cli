import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type { WsRpcProtocolClient } from "@t3tools/client-runtime/rpc";

import type { RpcError } from "./error.ts";

export type WsClient = WsRpcProtocolClient;

export interface T3RpcConnection {
  readonly client: WsClient;
  /** Fails when the socket closes; open streams use it, since the client does not end them. */
  readonly closed: Effect.Effect<never, RpcError>;
}

export type T3RpcService = {
  readonly getClient: Effect.Effect<WsClient, RpcError>;
  readonly getConnection: Effect.Effect<T3RpcConnection, RpcError>;
  readonly reconnect: Effect.Effect<WsClient, RpcError>;
  readonly disconnect: Effect.Effect<void>;
};

export class T3Rpc extends Context.Service<T3Rpc, T3RpcService>()("t3cli/T3Rpc") {}
