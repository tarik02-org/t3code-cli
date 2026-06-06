import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import { RpcClientError } from "effect/unstable/rpc";

import { RpcError } from "./error.ts";
import type { T3Rpc } from "./service.ts";
import type { CliRpcRequestError } from "./ws-group.ts";

export type CliRpcOperationError = CliRpcRequestError | RpcClientError.RpcClientError;

export const rpcRetrySchedule = Schedule.exponential("100 millis").pipe(
  Schedule.take(4),
  Schedule.collectWhile((metadata: Schedule.Metadata) =>
    Predicate.isTagged(metadata.input, "RpcClientError"),
  ),
);

export const runRpc =
  (rpc: T3Rpc["Service"], method: string) =>
  <A>(effect: Effect.Effect<A, CliRpcOperationError>): Effect.Effect<A, RpcError> =>
    effect.pipe(
      Effect.tapError((error) =>
        Predicate.isTagged(error, "RpcClientError") ? rpc.disconnect : Effect.void,
      ),
      Effect.retry(rpcRetrySchedule),
      Effect.mapError((error) => toRpcError(error, method)),
    );

export const subscribeRpc =
  (rpc: T3Rpc["Service"], method: string) =>
  <A>(stream: Stream.Stream<A, CliRpcOperationError>): Stream.Stream<A, RpcError> =>
    stream.pipe(
      Stream.tapError((error) =>
        Predicate.isTagged(error, "RpcClientError") ? rpc.disconnect : Effect.void,
      ),
      Stream.retry(rpcRetrySchedule),
      Stream.mapError((error) => toRpcError(error, method)),
    );

function toRpcError(error: CliRpcOperationError, method: string): RpcError {
  return new RpcError({
    message: error.message,
    method,
    cause: error,
  });
}
