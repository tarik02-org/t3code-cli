import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { HttpClient } from "effect/unstable/http";
import {
  ORCHESTRATION_WS_METHODS,
  ThreadId,
  WS_METHODS,
  type ClientOrchestrationCommand,
  type OrchestrationShellSnapshot,
  type OrchestrationShellStreamItem,
  type OrchestrationThreadStreamItem,
} from "@t3tools/contracts";
import { environmentEndpointUrl } from "@t3tools/client-runtime/environment";
import {
  executeEnvironmentHttpRequest,
  makeEnvironmentHttpApiClient,
} from "@t3tools/client-runtime/rpc";
import { applyShellStreamEvent } from "@t3tools/client-runtime/state/shell";

import { T3PreparedConnectionProvider } from "../connection/prepared.ts";
import { RpcError } from "../rpc/error.ts";
import { T3RpcOperations } from "../rpc/operation.ts";
import { ThreadSnapshotRequestError } from "./error.ts";
import { T3Orchestration, type OpenThread, type Orchestration } from "./service.ts";

const THREAD_SNAPSHOT_TIMEOUT_MS = 30_000;

export const makeT3Orchestration = Effect.fn("makeT3Orchestration")(function* () {
  const rpc = yield* T3RpcOperations;
  const preparedConnectionProvider = yield* T3PreparedConnectionProvider;
  const httpClient = yield* HttpClient.HttpClient;

  const watchShellSnapshots: Orchestration["watchShellSnapshots"] = () =>
    rpc
      .subscribe(ORCHESTRATION_WS_METHODS.subscribeShell, (client) =>
        client[ORCHESTRATION_WS_METHODS.subscribeShell]({}),
      )
      .pipe(
        Stream.filter(
          (
            item,
          ): item is Exclude<OrchestrationShellStreamItem, { readonly kind: "synchronized" }> =>
            item.kind !== "synchronized",
        ),
        Stream.mapAccum(
          () => Option.none<OrchestrationShellSnapshot>(),
          (
            current,
            item,
          ): readonly [
            Option.Option<OrchestrationShellSnapshot>,
            ReadonlyArray<OrchestrationShellSnapshot>,
          ] => {
            if (item.kind === "snapshot") {
              return [Option.some(item.snapshot), [item.snapshot]];
            }
            if (Option.isNone(current)) {
              return [current, []];
            }
            const next = applyShellStreamEvent(current.value, item);
            return [Option.some(next), [next]];
          },
        ),
      );

  const watchShellSequence: Orchestration["watchShellSequence"] = () =>
    rpc
      .subscribe(ORCHESTRATION_WS_METHODS.subscribeShell, (client) =>
        client[ORCHESTRATION_WS_METHODS.subscribeShell]({}),
      )
      .pipe(
        Stream.filter((item: OrchestrationShellStreamItem) => item.kind !== "synchronized"),
        Stream.map((item) =>
          item.kind === "snapshot" ? item.snapshot.snapshotSequence : item.sequence,
        ),
      );

  const watchThreadItems: Orchestration["watchThreadItems"] = (threadId: string) =>
    rpc.subscribe(ORCHESTRATION_WS_METHODS.subscribeThread, (client) =>
      client[ORCHESTRATION_WS_METHODS.subscribeThread]({ threadId: ThreadId.make(threadId) }),
    );

  const dispatch = Effect.fn("T3OrchestrationLive.dispatch")(function* (
    command: ClientOrchestrationCommand,
  ) {
    return yield* rpc.run(ORCHESTRATION_WS_METHODS.dispatchCommand, (client) =>
      client[ORCHESTRATION_WS_METHODS.dispatchCommand](command),
    );
  });
  const getServerConfig = Effect.fn("T3OrchestrationLive.getServerConfig")(function* () {
    return yield* rpc.run(WS_METHODS.serverGetConfig, (client) =>
      client[WS_METHODS.serverGetConfig]({}),
    );
  });
  const getShellSnapshot = Effect.fn("T3OrchestrationLive.getShellSnapshot")(function* () {
    const item = yield* Stream.runHead(
      rpc.subscribe(ORCHESTRATION_WS_METHODS.subscribeShell, (client) =>
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
      return yield* rpc.run(ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot, (client) =>
        client[ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot]({}),
      );
    },
  );
  const searchThreads = Effect.fn("T3OrchestrationLive.searchThreads")(function* (input) {
    return yield* rpc.run(ORCHESTRATION_WS_METHODS.searchThreads, (client) =>
      client[ORCHESTRATION_WS_METHODS.searchThreads](input),
    );
  });
  const getThreadSnapshot = Effect.fn("T3OrchestrationLive.getThreadSnapshot")(function* (
    threadId: string,
  ) {
    const item = yield* Stream.runHead(
      rpc.subscribe(ORCHESTRATION_WS_METHODS.subscribeThread, (client) =>
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
  const getThreadDetailSnapshot: Orchestration["getThreadDetailSnapshot"] = Effect.fn(
    "T3OrchestrationLive.getThreadDetailSnapshot",
  )(function* (input) {
    const paginationSupported =
      input.window === undefined
        ? true
        : (yield* getServerConfig()).threadSnapshotPagination === true;
    const window = paginationSupported ? input.window : undefined;
    const prepared = yield* preparedConnectionProvider.get.pipe(
      Effect.mapError(
        (cause) =>
          new ThreadSnapshotRequestError({
            message: "failed to prepare the thread snapshot request",
            threadId: input.threadId,
            cause,
          }),
      ),
    );
    const threadId = ThreadId.make(input.threadId);
    const requestUrl = environmentEndpointUrl(
      prepared.httpBaseUrl,
      `/api/orchestration/threads/${threadId}`,
    );
    const client = yield* makeEnvironmentHttpApiClient(prepared.httpBaseUrl).pipe(
      Effect.provideService(HttpClient.HttpClient, httpClient),
      Effect.mapError(
        (cause) =>
          new ThreadSnapshotRequestError({
            message: "failed to create the thread snapshot client",
            threadId: input.threadId,
            cause,
          }),
      ),
    );
    return yield* executeEnvironmentHttpRequest(
      requestUrl,
      THREAD_SNAPSHOT_TIMEOUT_MS,
      client.orchestration.threadSnapshot({
        params: { threadId },
        payload: {
          ...(window !== undefined ? { turnLimit: window.turnLimit } : {}),
          ...(window?.beforeCursor !== undefined ? { beforeCursor: window.beforeCursor } : {}),
        },
        headers: {
          authorization: `Bearer ${prepared.httpAuthorization.token}`,
        },
      }),
    ).pipe(
      Effect.provideService(HttpClient.HttpClient, httpClient),
      Effect.mapError(
        (cause) =>
          new ThreadSnapshotRequestError({
            message: "failed to load the thread snapshot",
            threadId: input.threadId,
            cause,
          }),
      ),
    );
  });
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
    searchThreads,
    getThreadSnapshot,
    getThreadDetailSnapshot,
    watchShellSnapshots,
    watchShellSequence,
    watchThreadItems,
    openThread,
  };
});

export const T3OrchestrationLive = Layer.effect(T3Orchestration, makeT3Orchestration());
