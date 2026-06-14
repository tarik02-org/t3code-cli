import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
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

import { RpcError } from "../rpc/error.ts";
import { runRpc, subscribeRpc } from "../rpc/operation.ts";
import { T3Rpc } from "../rpc/service.ts";
import { T3Orchestration, type OpenThread } from "./service.ts";

export const makeT3Orchestration = Effect.fn("makeT3Orchestration")(function* () {
  const rpc = yield* T3Rpc;
  const dispatch = Effect.fn("T3OrchestrationLive.dispatch")(function* (
    command: ClientOrchestrationCommand,
  ) {
    return yield* runRpc(rpc, ORCHESTRATION_WS_METHODS.dispatchCommand, (client) =>
      client[ORCHESTRATION_WS_METHODS.dispatchCommand](command),
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
  const getArchivedShellSnapshot = Effect.fn("T3OrchestrationLive.getArchivedShellSnapshot")(
    function* () {
      return yield* runRpc(rpc, ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot, (client) =>
        client[ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot]({}),
      );
    },
  );
  const getThreadSnapshot = Effect.fn("T3OrchestrationLive.getThreadSnapshot")(function* (
    threadId: string,
  ) {
    const item = yield* Stream.runHead(
      subscribeRpc(rpc, ORCHESTRATION_WS_METHODS.subscribeThread, (client) =>
        client[ORCHESTRATION_WS_METHODS.subscribeThread]({
          threadId: ThreadId.make(threadId),
        }),
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
      Stream.map((item: OrchestrationShellStreamItem) =>
        item.kind === "snapshot" ? item.snapshot.snapshotSequence : item.sequence,
      ),
    );
  const watchThreadItems = (threadId: string) =>
    subscribeRpc(rpc, ORCHESTRATION_WS_METHODS.subscribeThread, (client) =>
      client[ORCHESTRATION_WS_METHODS.subscribeThread]({ threadId: ThreadId.make(threadId) }),
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
    getArchivedShellSnapshot,
    getThreadSnapshot,
    watchShellSequence,
    watchThreadItems,
    openThread,
  };
});

export const T3OrchestrationLive = Layer.effect(T3Orchestration, makeT3Orchestration());
