import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";

import { type ClientOrchestrationCommand } from "../domain/command-schema.ts";
import {
  ORCHESTRATION_WS_METHODS,
  type ShellStreamItem,
  type ThreadStreamItem,
  WS_METHODS,
} from "../protocol/schema.ts";
import { RpcError } from "../rpc/error.ts";
import { T3Rpc } from "../rpc/service.ts";
import { T3Orchestration, type OpenThread } from "./service.ts";

export const makeT3Orchestration = Effect.fn("makeT3Orchestration")(function* () {
  const rpc = yield* T3Rpc;
  const dispatch = Effect.fn("T3OrchestrationLive.dispatch")(function* (
    command: ClientOrchestrationCommand,
  ) {
    const client = yield* rpc.getClient;
    return yield* client[ORCHESTRATION_WS_METHODS.dispatchCommand](command).pipe(
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
    const client = yield* rpc.getClient;
    return yield* client[WS_METHODS.serverGetConfig]({}).pipe(
      Effect.catchTags({
        RpcClientError: (error) =>
          Effect.fail(
            new RpcError({
              message: error.message,
              method: WS_METHODS.serverGetConfig,
              cause: error,
            }),
          ),
        RpcError: (error) => Effect.fail(error),
      }),
    );
  });
  const getShellSnapshot = Effect.fn("T3OrchestrationLive.getShellSnapshot")(function* () {
    const item = yield* Stream.runHead(
      Stream.unwrap(
        Effect.map(rpc.getClient, (client) => client[ORCHESTRATION_WS_METHODS.subscribeShell]({})),
      ),
    ).pipe(
      Effect.catchTags({
        RpcClientError: (error) =>
          Effect.fail(
            new RpcError({
              message: error.message,
              method: ORCHESTRATION_WS_METHODS.subscribeShell,
              cause: error,
            }),
          ),
        RpcError: (error) => Effect.fail(error),
      }),
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
      Stream.unwrap(
        Effect.map(rpc.getClient, (client) =>
          client[ORCHESTRATION_WS_METHODS.subscribeThread]({ threadId }),
        ),
      ),
    ).pipe(
      Effect.catchTags({
        RpcClientError: (error) =>
          Effect.fail(
            new RpcError({
              message: error.message,
              method: ORCHESTRATION_WS_METHODS.subscribeThread,
              cause: error,
            }),
          ),
        RpcError: (error) => Effect.fail(error),
      }),
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
    Stream.unwrap(
      Effect.map(rpc.getClient, (client) => client[ORCHESTRATION_WS_METHODS.subscribeShell]({})),
    ).pipe(
      Stream.catchTags({
        RpcClientError: (error) =>
          Stream.fail(
            new RpcError({
              message: error.message,
              method: ORCHESTRATION_WS_METHODS.subscribeShell,
              cause: error,
            }),
          ),
        RpcError: (error) => Stream.fail(error),
      }),
      Stream.map((item: ShellStreamItem) =>
        item.kind === "snapshot" ? item.snapshot.snapshotSequence : item.sequence,
      ),
    );
  const openThread = Effect.fn("T3OrchestrationLive.openThread")(function* (threadId: string) {
    return yield* Stream.unwrap(
      Effect.map(rpc.getClient, (client) =>
        client[ORCHESTRATION_WS_METHODS.subscribeThread]({ threadId }),
      ),
    ).pipe(
      Stream.catchTags({
        RpcClientError: (error) =>
          Stream.fail(
            new RpcError({
              message: error.message,
              method: ORCHESTRATION_WS_METHODS.subscribeThread,
              cause: error,
            }),
          ),
        RpcError: (error) => Stream.fail(error),
      }),
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
    openThread,
  };
});

export const T3OrchestrationLive = Layer.effect(T3Orchestration, makeT3Orchestration());
