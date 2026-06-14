import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import { RpcClientError } from "effect/unstable/rpc";

import { RpcError } from "./error.ts";
import type { T3Rpc, WsClient } from "./service.ts";
import type { CliRpcRequestError } from "./ws-group.ts";

export type CliRpcOperationError = CliRpcRequestError | RpcClientError.RpcClientError;

export const rpcRetrySchedule = Schedule.exponential("100 millis").pipe(
  Schedule.take(4),
  Schedule.collectWhile((metadata: Schedule.Metadata) =>
    Predicate.isTagged(metadata.input, "RpcClientError"),
  ),
);

export function runRpc<A, R>(
  rpc: T3Rpc["Service"],
  method: string,
  operation: (client: WsClient) => Effect.Effect<A, CliRpcOperationError, R>,
): Effect.Effect<A, RpcError, R> {
  return rpc.getClient.pipe(
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

export function subscribeRpc<A>(
  rpc: T3Rpc["Service"],
  method: string,
  operation: (client: WsClient) => Stream.Stream<A, CliRpcOperationError>,
): Stream.Stream<A, RpcError> {
  return Stream.unwrap(rpc.getClient.pipe(Effect.map((client) => operation(client)))).pipe(
    Stream.tapError((error) =>
      Predicate.isTagged(error, "RpcClientError") ? rpc.disconnect : Effect.void,
    ),
    Stream.retry(rpcRetrySchedule),
    Stream.mapError((error) =>
      Predicate.isTagged(error, "RpcError") ? error : toRpcError(error, method),
    ),
  );
}

function toRpcError(error: CliRpcOperationError, method: string): RpcError {
  return new RpcError({
    message: error.message,
    method,
    cause: error,
  });
}
