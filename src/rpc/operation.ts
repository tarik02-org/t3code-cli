import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import { RpcClientError } from "effect/unstable/rpc";

import { RpcError } from "./error.ts";
import type { T3Rpc } from "./service.ts";
import type { CliRpcRequestError } from "./ws-group.ts";

export type CliRpcOperationError = CliRpcRequestError | RpcClientError.RpcClientError | RpcError;

export const rpcRetrySchedule = Schedule.exponential("100 millis").pipe(
  Schedule.take(4),
  Schedule.collectWhile((metadata: Schedule.Metadata) => {
    const input = metadata.input;
    return (
      typeof input === "object" && input !== null && Reflect.get(input, "_tag") === "RpcClientError"
    );
  }),
);

export function runRpc<A>(
  rpc: T3Rpc["Service"],
  method: string,
  effect: Effect.Effect<A, CliRpcOperationError>,
): Effect.Effect<A, RpcError> {
  return effect.pipe(
    Effect.tapError((error) => (error["_tag"] === "RpcClientError" ? rpc.disconnect : Effect.void)),
    Effect.retry(rpcRetrySchedule),
    Effect.mapError((error) => toRpcError(error, method)),
  );
}

export function subscribeRpc<A>(
  rpc: T3Rpc["Service"],
  method: string,
  stream: Stream.Stream<A, CliRpcOperationError>,
): Stream.Stream<A, RpcError> {
  return stream.pipe(
    Stream.tapError((error) => (error["_tag"] === "RpcClientError" ? rpc.disconnect : Effect.void)),
    Stream.retry(rpcRetrySchedule),
    Stream.mapError((error) => toRpcError(error, method)),
  );
}

function toRpcError(error: CliRpcOperationError, method: string): RpcError {
  if (error["_tag"] === "RpcError") {
    return error;
  }
  return new RpcError({
    message: error.message,
    method,
  });
}
