import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import { RpcClientError } from "effect/unstable/rpc";

import { RpcError } from "./error.ts";
import { T3Rpc, type WsClient } from "./service.ts";
import type { CliRpcRequestError } from "./ws-group.ts";

export type CliRpcOperationError = CliRpcRequestError | RpcClientError.RpcClientError;

export const rpcRetrySchedule = Schedule.exponential("100 millis").pipe(
  Schedule.take(4),
  Schedule.collectWhile((metadata: Schedule.Metadata) =>
    Predicate.isTagged(metadata.input, "RpcClientError"),
  ),
);

export function runRpc<A, R>(
  method: string,
  operation: (client: WsClient) => Effect.Effect<A, CliRpcOperationError, R>,
): Effect.Effect<A, RpcError, R> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- T3Rpc is provided by AppLayer when rpc helpers run
  return Effect.gen(function* () {
    const rpc = yield* T3Rpc;
    return yield* rpc.getClient.pipe(
      Effect.flatMap((client) => operation(client)),
      Effect.tapError((error) =>
        Predicate.isTagged(error, "RpcClientError") ? rpc.disconnect : Effect.void,
      ),
      Effect.retry(rpcRetrySchedule),
      Effect.mapError((error) =>
        Predicate.isTagged(error, "RpcError") ? error : toRpcError(error, method),
      ),
    );
  }) as Effect.Effect<A, RpcError, R>;
}

export function subscribeRpc<A>(
  method: string,
  operation: (client: WsClient) => Stream.Stream<A, CliRpcOperationError>,
): Stream.Stream<A, RpcError> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- T3Rpc is provided by AppLayer when rpc helpers run
  return Stream.unwrap(
    T3Rpc.pipe(
      Effect.flatMap((rpc) => rpc.getClient.pipe(Effect.map((client) => operation(client)))),
    ),
  ).pipe(
    Stream.tapError((error) =>
      Predicate.isTagged(error, "RpcClientError")
        ? T3Rpc.pipe(Effect.flatMap((rpc) => rpc.disconnect))
        : Effect.void,
    ),
    Stream.retry(rpcRetrySchedule),
    Stream.mapError((error) =>
      Predicate.isTagged(error, "RpcError") ? error : toRpcError(error, method),
    ),
  ) as Stream.Stream<A, RpcError>;
}

function toRpcError(error: CliRpcOperationError, method: string): RpcError {
  return new RpcError({
    message: error.message,
    method,
    cause: error,
  });
}
