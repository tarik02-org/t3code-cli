import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { RpcClientError } from "effect/unstable/rpc";

import { type ClientOrchestrationCommand } from "../domain/command-schema.ts";
import {
  ORCHESTRATION_WS_METHODS,
  type ShellStreamItem,
  type ThreadStreamItem,
  WS_METHODS,
} from "../protocol/schema.ts";
import { RpcError } from "../rpc/error.ts";
import { T3Rpc, type WsClient } from "../rpc/service.ts";
import { T3Orchestration, type OpenThread } from "./service.ts";

type ReconnectableRpcError = RpcClientError.RpcClientError | RpcError;

const rpcRetrySchedule = Schedule.exponential("100 millis").pipe(
  Schedule.take(4),
  Schedule.collectWhile(
    (metadata: Schedule.Metadata<unknown, ReconnectableRpcError>) =>
      metadata.input instanceof RpcClientError.RpcClientError,
  ),
);

function runRpc<A>(
  rpc: T3Rpc["Service"],
  method: string,
  f: (client: WsClient) => Effect.Effect<A, ReconnectableRpcError>,
) {
  return Effect.gen(function* () {
    const client = yield* rpc.getClient;
    return yield* f(client);
  }).pipe(
    Effect.tapError((error) =>
      error instanceof RpcClientError.RpcClientError ? rpc.disconnect : Effect.void,
    ),
    Effect.retry(rpcRetrySchedule),
    Effect.catchTags({
      RpcClientError: (error) =>
        Effect.fail(
          new RpcError({
            message: error.message,
            method,
            cause: error,
          }),
        ),
      RpcError: (error) => Effect.fail(error),
    }),
  );
}

function subscribeRpc<A>(
  rpc: T3Rpc["Service"],
  method: string,
  f: (client: WsClient) => Stream.Stream<A, ReconnectableRpcError>,
) {
  return Stream.unwrap(Effect.map(rpc.getClient, f)).pipe(
    Stream.tapError((error) =>
      error instanceof RpcClientError.RpcClientError ? rpc.disconnect : Effect.void,
    ),
    Stream.retry(rpcRetrySchedule),
    Stream.catchTags({
      RpcClientError: (error) =>
        Stream.fail(
          new RpcError({
            message: error.message,
            method,
            cause: error,
          }),
        ),
      RpcError: (error) => Stream.fail(error),
    }),
  );
}

export const makeT3Orchestration = Effect.fn("makeT3Orchestration")(function* () {
  const rpc = yield* T3Rpc;
  const dispatch = Effect.fn("T3OrchestrationLive.dispatch")(function* (
    command: ClientOrchestrationCommand,
  ) {
    const client = yield* rpc.getClient;
    return yield* client[ORCHESTRATION_WS_METHODS.dispatchCommand](command).pipe(
      Effect.tapErrorTag("RpcClientError", () => rpc.disconnect),
      Effect.catchTags({
        RpcClientError: (error) =>
          Effect.fail(
            new RpcError({
              message: error.message,
              method: ORCHESTRATION_WS_METHODS.dispatchCommand,
              cause: error,
            }),
          ),
        RpcError: (error) => Effect.fail(error),
      }),
    );
  });
  const getServerConfig = Effect.fn("T3OrchestrationLive.getServerConfig")(function* () {
    return yield* runRpc(rpc, WS_METHODS.serverGetConfig, (client) =>
      client[WS_METHODS.serverGetConfig]({}),
    );
  });
  const getShellSnapshot = Effect.fn("T3OrchestrationLive.getShellSnapshot")(function* () {
    const item = yield* Stream.runHead(
      subscribeRpc(rpc, ORCHESTRATION_WS_METHODS.subscribeShell, (client) =>
        client[ORCHESTRATION_WS_METHODS.subscribeShell]({}),
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
      subscribeRpc(rpc, ORCHESTRATION_WS_METHODS.subscribeThread, (client) =>
        client[ORCHESTRATION_WS_METHODS.subscribeThread]({ threadId }),
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
    subscribeRpc(rpc, ORCHESTRATION_WS_METHODS.subscribeShell, (client) =>
      client[ORCHESTRATION_WS_METHODS.subscribeShell]({}),
    ).pipe(
      Stream.map((item: ShellStreamItem) =>
        item.kind === "snapshot" ? item.snapshot.snapshotSequence : item.sequence,
      ),
    );
  const watchThreadItems = (threadId: string) =>
    subscribeRpc(rpc, ORCHESTRATION_WS_METHODS.subscribeThread, (client) =>
      client[ORCHESTRATION_WS_METHODS.subscribeThread]({ threadId }),
    );
  const openThread = Effect.fn("T3OrchestrationLive.openThread")(function* (threadId: string) {
    return yield* watchThreadItems(threadId).pipe(
      Stream.peel(Sink.head<ThreadStreamItem>()),
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
              (next): next is Extract<ThreadStreamItem, { readonly kind: "event" }> =>
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
