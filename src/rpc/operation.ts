import type {
  EnvironmentAuthorizationError,
  KeybindingsConfigError,
  OrchestrationDispatchCommandError,
  OrchestrationGetSnapshotError,
  PreviewAutomationError,
  ServerSettingsError,
  TerminalError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import { RpcClientError } from "effect/unstable/rpc";

import { RpcError } from "./error.ts";
import { T3Rpc, type WsClient } from "./service.ts";

export type CliRpcOperationError =
  | EnvironmentAuthorizationError
  | KeybindingsConfigError
  | OrchestrationDispatchCommandError
  | OrchestrationGetSnapshotError
  | PreviewAutomationError
  | RpcClientError.RpcClientError
  | ServerSettingsError
  | TerminalError;

export const rpcRetrySchedule = Schedule.exponential("100 millis").pipe(
  Schedule.setInputType<CliRpcOperationError | RpcError>(),
  Schedule.upTo({ times: 4 }),
  Schedule.while((metadata) => Predicate.isTagged(metadata.input, "RpcClientError")),
);

export type T3RpcOperationsService = {
  readonly run: <A, R>(
    method: string,
    operation: (client: WsClient) => Effect.Effect<A, CliRpcOperationError, R>,
  ) => Effect.Effect<A, RpcError, R>;
  readonly subscribe: <A>(
    method: string,
    operation: (client: WsClient) => Stream.Stream<A, CliRpcOperationError>,
  ) => Stream.Stream<A, RpcError>;
};

export class T3RpcOperations extends Context.Service<T3RpcOperations, T3RpcOperationsService>()(
  "t3cli/T3RpcOperations",
) {}

export const makeT3RpcOperations = Effect.fn("makeT3RpcOperations")(function* () {
  const rpc = yield* T3Rpc;

  const run: T3RpcOperationsService["run"] = <A, R>(
    method: string,
    operation: (client: WsClient) => Effect.Effect<A, CliRpcOperationError, R>,
  ): Effect.Effect<A, RpcError, R> =>
    rpc.getClient.pipe(
      Effect.flatMap((client) => operation(client)),
      Effect.tapError((error) =>
        Predicate.isTagged(error, "RpcClientError") ? rpc.disconnect : Effect.void,
      ),
      Effect.retry(rpcRetrySchedule),
      Effect.mapError((error) => (error instanceof RpcError ? error : toRpcError(error, method))),
    );

  const subscribe: T3RpcOperationsService["subscribe"] = <A>(
    method: string,
    operation: (client: WsClient) => Stream.Stream<A, CliRpcOperationError>,
  ): Stream.Stream<A, RpcError> =>
    Stream.unwrap(rpc.getClient.pipe(Effect.map((client) => operation(client)))).pipe(
      Stream.tapError((error) =>
        Predicate.isTagged(error, "RpcClientError") ? rpc.disconnect : Effect.void,
      ),
      Stream.retry(rpcRetrySchedule),
      Stream.mapError((error) => (error instanceof RpcError ? error : toRpcError(error, method))),
    );

  return {
    run,
    subscribe,
  } satisfies T3RpcOperationsService;
});

export const T3RpcOperationsLive = Layer.effect(T3RpcOperations, makeT3RpcOperations());

function toRpcError(error: CliRpcOperationError, method: string): RpcError {
  return new RpcError({
    message: error.message,
    method,
    cause: error,
  });
}
