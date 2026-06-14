import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import { RpcClientError } from "effect/unstable/rpc";

import { RpcError } from "./error.ts";
import { T3Rpc, type T3RpcService, type WsClient } from "./service.ts";
import type { CliRpcRequestError } from "./ws-group.ts";

export type CliRpcOperationError = CliRpcRequestError | RpcClientError.RpcClientError;

export const rpcRetrySchedule = Schedule.exponential("100 millis").pipe(
  Schedule.take(4),
  Schedule.collectWhile((metadata: Schedule.Metadata) =>
    Predicate.isTagged(metadata.input, "RpcClientError"),
  ),
);

export type RpcOperations = {
  readonly runRpc: <A, R>(
    method: string,
    operation: (client: WsClient) => Effect.Effect<A, CliRpcOperationError, R>,
  ) => Effect.Effect<A, RpcError, R>;
  readonly subscribeRpc: <A>(
    method: string,
    operation: (client: WsClient) => Stream.Stream<A, CliRpcOperationError>,
  ) => Stream.Stream<A, RpcError>;
};

function makeRunRpc(rpc: T3RpcService): RpcOperations["runRpc"] {
  return <A, R>(
    method: string,
    operation: (client: WsClient) => Effect.Effect<A, CliRpcOperationError, R>,
  ): Effect.Effect<A, RpcError, R> =>
    rpc.getClient.pipe(
      Effect.flatMap((client) => operation(client)),
      Effect.tapError((error) =>
        Predicate.isTagged(error, "RpcClientError") ? rpc.disconnect : Effect.void,
      ),
      Effect.retry(rpcRetrySchedule),
      Effect.mapError((error) =>
        Predicate.isTagged(error, "RpcError") ? error : toRpcError(error, method),
      ),
    );
}

function makeSubscribeRpc(rpc: T3RpcService): RpcOperations["subscribeRpc"] {
  return <A>(
    method: string,
    operation: (client: WsClient) => Stream.Stream<A, CliRpcOperationError>,
  ): Stream.Stream<A, RpcError> =>
    Stream.unwrap(rpc.getClient.pipe(Effect.map((client) => operation(client)))).pipe(
      Stream.tapError((error) =>
        Predicate.isTagged(error, "RpcClientError") ? rpc.disconnect : Effect.void,
      ),
      Stream.retry(rpcRetrySchedule),
      Stream.mapError((error) =>
        Predicate.isTagged(error, "RpcError") ? error : toRpcError(error, method),
      ),
    );
}

export const makeRpcOperations = Effect.gen(function* () {
  const rpc = yield* T3Rpc;
  return {
    runRpc: makeRunRpc(rpc),
    subscribeRpc: makeSubscribeRpc(rpc),
  } satisfies RpcOperations;
});

function toRpcError(error: CliRpcOperationError, method: string): RpcError {
  return new RpcError({
    message: error.message,
    method,
    cause: error,
  });
}
