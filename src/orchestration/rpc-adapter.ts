import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";

import { ORCHESTRATION_WS_METHODS, type ThreadStreamItem, WS_METHODS } from "./schema.ts";
import type { ClientOrchestrationCommand } from "../domain/command-schema.ts";
import { RpcError } from "./error.ts";
import type { T3Rpc } from "../rpc/service.ts";
import type { OpenThread } from "./service.ts";

export function dispatchCommand(rpc: T3Rpc["Service"], command: ClientOrchestrationCommand) {
  return Effect.gen(function* () {
    const client = yield* rpc.getClient;
    return yield* client[ORCHESTRATION_WS_METHODS.dispatchCommand](command);
  }).pipe(
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
}

export function getServerConfig(rpc: T3Rpc["Service"]) {
  return Effect.gen(function* () {
    const client = yield* rpc.getClient;
    return yield* client[WS_METHODS.serverGetConfig]({});
  }).pipe(
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
}

export function getShellSnapshot(rpc: T3Rpc["Service"]) {
  return Stream.runHead(
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
    Effect.flatMap((item) => {
      const value = Option.getOrUndefined(item);
      if (!value || value.kind !== "snapshot") {
        return Effect.fail(
          new RpcError({
            message: "server did not return shell snapshot",
            method: ORCHESTRATION_WS_METHODS.subscribeShell,
          }),
        );
      }
      return Effect.succeed(value.snapshot);
    }),
  );
}

export function getThreadSnapshot(rpc: T3Rpc["Service"], threadId: string) {
  return Stream.runHead(
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
    Effect.flatMap((item) => {
      const value = Option.getOrUndefined(item);
      if (!value || value.kind !== "snapshot") {
        return Effect.fail(
          new RpcError({
            message: `thread ${threadId} not found`,
            method: ORCHESTRATION_WS_METHODS.subscribeThread,
          }),
        );
      }
      return Effect.succeed(value.snapshot.thread);
    }),
  );
}

export function openThread(rpc: T3Rpc["Service"], threadId: string) {
  return Stream.unwrap(
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
      if (!value || value.kind !== "snapshot") {
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
}
