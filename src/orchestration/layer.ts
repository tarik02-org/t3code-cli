import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import {
  ORCHESTRATION_WS_METHODS,
  ThreadId,
  WS_METHODS,
  type ClientOrchestrationCommand,
  type OrchestrationShellStreamItem,
  type OrchestrationThreadStreamItem,
} from "#t3tools/contracts";
import { RpcClientError } from "effect/unstable/rpc";

import { RpcError } from "../rpc/error.ts";
import { T3Rpc } from "../rpc/service.ts";
import { T3Orchestration, type OpenThread } from "./service.ts";

const rpcRetrySchedule = Schedule.exponential("100 millis").pipe(
  Schedule.take(4),
  Schedule.collectWhile((metadata: Schedule.Metadata) => {
    const input = metadata.input;
    return (
      typeof input === "object" &&
      input !== null &&
      "_tag" in input &&
      input["_tag"] === "RpcClientError"
    );
  }),
);
type RpcOperationError = RpcClientError.RpcClientError | RpcError | { readonly message: string };

function runRpc<A>(
  rpc: T3Rpc["Service"],
  method: string,
  effect: Effect.Effect<A, RpcOperationError>,
): Effect.Effect<A, RpcError> {
  return effect.pipe(
    Effect.tapError((error) => (isRpcClientTransportError(error) ? rpc.disconnect : Effect.void)),
    Effect.retry(rpcRetrySchedule),
    Effect.mapError((error) => toRpcError(error, method)),
  );
}

function subscribeRpc<A>(
  rpc: T3Rpc["Service"],
  method: string,
  stream: Stream.Stream<A, RpcOperationError>,
): Stream.Stream<A, RpcError> {
  return stream.pipe(
    Stream.tapError((error) => (isRpcClientTransportError(error) ? rpc.disconnect : Effect.void)),
    Stream.retry(rpcRetrySchedule),
    Stream.mapError((error) => toRpcError(error, method)),
  );
}

export const makeT3Orchestration = Effect.fn("makeT3Orchestration")(function* () {
  const rpc = yield* T3Rpc;
  const dispatch = Effect.fn("T3OrchestrationLive.dispatch")(function* (
    command: ClientOrchestrationCommand,
  ) {
    return yield* runRpc(
      rpc,
      ORCHESTRATION_WS_METHODS.dispatchCommand,
      rpc.getClient.pipe(
        Effect.flatMap((client) => client[ORCHESTRATION_WS_METHODS.dispatchCommand](command)),
      ),
    );
  });
  const getServerConfig = Effect.fn("T3OrchestrationLive.getServerConfig")(function* () {
    return yield* runRpc(
      rpc,
      WS_METHODS.serverGetConfig,
      rpc.getClient.pipe(Effect.flatMap((client) => client[WS_METHODS.serverGetConfig]({}))),
    );
  });
  const getShellSnapshot = Effect.fn("T3OrchestrationLive.getShellSnapshot")(function* () {
    const item = yield* Stream.runHead(
      subscribeRpc(
        rpc,
        ORCHESTRATION_WS_METHODS.subscribeShell,
        Stream.unwrap(
          rpc.getClient.pipe(
            Effect.map((client) => client[ORCHESTRATION_WS_METHODS.subscribeShell]({})),
          ),
        ),
      ),
    );
    const value = Option.getOrUndefined(item);
    if (value === undefined || value.kind !== "snapshot") {
      return yield* Effect.fail(
        new RpcError({
          message: "server did not return shell snapshot",
          method: ORCHESTRATION_WS_METHODS.subscribeShell,
        }),
      );
    }
    return value.snapshot;
  });
  const getThreadSnapshot = Effect.fn("T3OrchestrationLive.getThreadSnapshot")(function* (
    threadId: string,
  ) {
    const item = yield* Stream.runHead(
      subscribeRpc(
        rpc,
        ORCHESTRATION_WS_METHODS.subscribeThread,
        Stream.unwrap(
          rpc.getClient.pipe(
            Effect.map((client) =>
              client[ORCHESTRATION_WS_METHODS.subscribeThread]({
                threadId: ThreadId.make(threadId),
              }),
            ),
          ),
        ),
      ),
    );
    const value = Option.getOrUndefined(item);
    if (value === undefined || value.kind !== "snapshot") {
      return yield* Effect.fail(
        new RpcError({
          message: `thread ${threadId} not found`,
          method: ORCHESTRATION_WS_METHODS.subscribeThread,
        }),
      );
    }
    return value.snapshot.thread;
  });
  const watchShellSequence = () =>
    subscribeRpc(
      rpc,
      ORCHESTRATION_WS_METHODS.subscribeShell,
      Stream.unwrap(
        rpc.getClient.pipe(
          Effect.map((client) => client[ORCHESTRATION_WS_METHODS.subscribeShell]({})),
        ),
      ),
    ).pipe(
      Stream.map((item: OrchestrationShellStreamItem) =>
        item.kind === "snapshot" ? item.snapshot.snapshotSequence : item.sequence,
      ),
    );
  const watchThreadItems = (threadId: string) =>
    subscribeRpc(
      rpc,
      ORCHESTRATION_WS_METHODS.subscribeThread,
      Stream.unwrap(
        rpc.getClient.pipe(
          Effect.map((client) =>
            client[ORCHESTRATION_WS_METHODS.subscribeThread]({ threadId: ThreadId.make(threadId) }),
          ),
        ),
      ),
    );
  const openThread = Effect.fn("T3OrchestrationLive.openThread")(function* (threadId: string) {
    return yield* watchThreadItems(threadId).pipe(
      Stream.peel(Sink.head<OrchestrationThreadStreamItem>()),
      Effect.flatMap(([item, rest]) => {
        const value = Option.getOrUndefined(item);
        if (value === undefined || value.kind !== "snapshot") {
          return Effect.fail(
            new RpcError({
              message: `thread ${threadId} not found`,
              method: ORCHESTRATION_WS_METHODS.subscribeThread,
            }),
          );
        }
        return Effect.succeed({
          snapshot: value.snapshot.thread,
          events: rest.pipe(
            Stream.filter(
              (next): next is Extract<OrchestrationThreadStreamItem, { readonly kind: "event" }> =>
                next.kind === "event",
            ),
            Stream.map((next) => next.event),
          ),
        } satisfies OpenThread);
      }),
    );
  });

  return {
    dispatch,
    getServerConfig,
    getShellSnapshot,
    getThreadSnapshot,
    watchShellSequence,
    watchThreadItems,
    openThread,
  };
});

export const T3OrchestrationLive = Layer.effect(T3Orchestration, makeT3Orchestration());

function toRpcError(error: RpcOperationError, method: string) {
  if ("_tag" in error && error["_tag"] === "RpcError") {
    return error;
  }
  return new RpcError({
    message: error.message,
    method,
  });
}

function isRpcClientTransportError(
  error: RpcOperationError,
): error is RpcClientError.RpcClientError {
  return "_tag" in error && error["_tag"] === "RpcClientError";
}
