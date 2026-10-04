import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { HttpClient } from "effect/unstable/http";
import {
  ORCHESTRATION_PROTOCOL_HEADER,
  ORCHESTRATION_PROTOCOL_VERSION_TEXT,
  ORCHESTRATION_V2_WS_METHODS,
  ThreadId,
  WS_METHODS,
  type OrchestrationV2Command,
  type OrchestrationV2ShellStreamItem,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import { environmentEndpointUrl } from "@t3tools/client-runtime/environment";
import {
  executeEnvironmentHttpRequest,
  makeEnvironmentHttpApiClient,
} from "@t3tools/client-runtime/rpc";
import { applyOrchestrationV2ProjectionEvent } from "@t3tools/client-runtime/state/orchestration-v2-projection";

import { T3PreparedConnectionProvider } from "../connection/prepared.ts";
import { RpcError } from "../rpc/error.ts";
import { T3RpcOperations } from "../rpc/operation.ts";
import { ThreadSnapshotRequestError } from "./error.ts";
import { T3Orchestration, type Orchestration, type ThreadState } from "./service.ts";

const THREAD_SNAPSHOT_TIMEOUT_MS = 30_000;

type HttpApiClient = Effect.Success<ReturnType<typeof makeEnvironmentHttpApiClient>>;

export const makeT3Orchestration = Effect.fn("makeT3Orchestration")(function* () {
  const rpc = yield* T3RpcOperations;
  const preparedConnectionProvider = yield* T3PreparedConnectionProvider;
  const httpClient = yield* HttpClient.HttpClient;

  const subscribeShell = () =>
    rpc.subscribe(ORCHESTRATION_V2_WS_METHODS.subscribeShell, (client) =>
      client[ORCHESTRATION_V2_WS_METHODS.subscribeShell]({}),
    );

  const watchShellSequence: Orchestration["watchShellSequence"] = () =>
    subscribeShell().pipe(
      Stream.filter(
        (
          item,
        ): item is Exclude<OrchestrationV2ShellStreamItem, { readonly kind: "synchronized" }> =>
          item.kind !== "synchronized",
      ),
      Stream.map((item) =>
        item.kind === "snapshot" ? item.snapshot.snapshotSequence : item.sequence,
      ),
    );

  const watchThread: Orchestration["watchThread"] = (threadId) =>
    rpc
      .subscribe(ORCHESTRATION_V2_WS_METHODS.subscribeThread, (client) =>
        client[ORCHESTRATION_V2_WS_METHODS.subscribeThread]({ threadId: ThreadId.make(threadId) }),
      )
      .pipe(
        Stream.mapAccumEffect(
          () => Option.none<ThreadState>(),
          (current, item) => {
            if (item.kind === "snapshot") {
              const next: ThreadState = {
                sequence: item.snapshotSequence,
                projection: item.projection,
                event: null,
              };
              return Effect.succeed([Option.some(next), [next]] as const);
            }
            if (item.kind === "synchronized") {
              return Effect.succeed([current, []] as const);
            }
            if (Option.isNone(current)) {
              return Effect.fail(
                new RpcError({
                  message: `thread stream event received before snapshot: ${threadId}`,
                  method: ORCHESTRATION_V2_WS_METHODS.subscribeThread,
                }),
              );
            }
            if (item.sequence <= current.value.sequence) {
              return Effect.succeed([current, []] as const);
            }
            if (item.kind === "unknown-event") {
              // Newer servers add event types; skip them but keep the resume cursor moving.
              const next: ThreadState = { ...current.value, sequence: item.sequence, event: null };
              return Effect.succeed([Option.some(next), []] as const);
            }
            const projection: OrchestrationV2ThreadProjection =
              applyOrchestrationV2ProjectionEvent(current.value.projection, item.event) ??
              current.value.projection;
            const next: ThreadState = { sequence: item.sequence, projection, event: item.event };
            return Effect.succeed([Option.some(next), [next]] as const);
          },
        ),
      );

  const dispatch = Effect.fn("T3OrchestrationLive.dispatch")(function* (
    command: OrchestrationV2Command,
  ) {
    return yield* rpc.run(ORCHESTRATION_V2_WS_METHODS.dispatchCommand, (client) =>
      client[ORCHESTRATION_V2_WS_METHODS.dispatchCommand](command),
    );
  });
  const mutateProject: Orchestration["mutateProject"] = Effect.fn(
    "T3OrchestrationLive.mutateProject",
  )(function* (mutation) {
    return yield* rpc.run(WS_METHODS.projectsMutate, (client) =>
      client[WS_METHODS.projectsMutate](mutation),
    );
  });
  const launchThread: Orchestration["launchThread"] = Effect.fn("T3OrchestrationLive.launchThread")(
    function* (input) {
      return yield* rpc.run(ORCHESTRATION_V2_WS_METHODS.launchThread, (client) =>
        client[ORCHESTRATION_V2_WS_METHODS.launchThread](input),
      );
    },
  );
  const getServerConfig = Effect.fn("T3OrchestrationLive.getServerConfig")(function* () {
    return yield* rpc.run(WS_METHODS.serverGetConfig, (client) =>
      client[WS_METHODS.serverGetConfig]({}),
    );
  });
  const getShellSnapshot = Effect.fn("T3OrchestrationLive.getShellSnapshot")(function* () {
    const item = yield* Stream.runHead(
      subscribeShell().pipe(Stream.filter((next) => next.kind !== "synchronized")),
    );
    const value = Option.getOrUndefined(item);
    if (value === undefined || value.kind !== "snapshot") {
      return yield* Effect.fail(
        new RpcError({
          message: "server did not return shell snapshot",
          method: ORCHESTRATION_V2_WS_METHODS.subscribeShell,
        }),
      );
    }
    return value.snapshot;
  });
  const getArchivedShellSnapshot = Effect.fn("T3OrchestrationLive.getArchivedShellSnapshot")(
    function* () {
      return yield* rpc.run(ORCHESTRATION_V2_WS_METHODS.getArchivedShellSnapshot, (client) =>
        client[ORCHESTRATION_V2_WS_METHODS.getArchivedShellSnapshot]({}),
      );
    },
  );
  const searchThreads: Orchestration["searchThreads"] = Effect.fn(
    "T3OrchestrationLive.searchThreads",
  )(function* (input) {
    return yield* rpc.run(ORCHESTRATION_V2_WS_METHODS.searchThreads, (client) =>
      client[ORCHESTRATION_V2_WS_METHODS.searchThreads](input),
    );
  });
  const getThreadProjection = Effect.fn("T3OrchestrationLive.getThreadProjection")(function* (
    threadId: string,
  ) {
    return yield* rpc.run(ORCHESTRATION_V2_WS_METHODS.getThreadProjection, (client) =>
      client[ORCHESTRATION_V2_WS_METHODS.getThreadProjection]({
        threadId: ThreadId.make(threadId),
      }),
    );
  });

  const requestThreadSnapshot = <A, E>(input: {
    readonly threadId: string;
    readonly path: string;
    readonly description: string;
    readonly request: (
      client: HttpApiClient,
      headers: {
        readonly authorization: string;
        readonly [ORCHESTRATION_PROTOCOL_HEADER]: typeof ORCHESTRATION_PROTOCOL_VERSION_TEXT;
      },
    ) => Effect.Effect<A, E>;
  }) =>
    Effect.gen(function* () {
      const fail = (message: string) => (cause: unknown) =>
        new ThreadSnapshotRequestError({ message, threadId: input.threadId, cause });
      const prepared = yield* preparedConnectionProvider.get.pipe(
        Effect.mapError(fail(`failed to prepare the ${input.description} request`)),
      );
      const client = yield* makeEnvironmentHttpApiClient(prepared.httpBaseUrl).pipe(
        Effect.provideService(HttpClient.HttpClient, httpClient),
        Effect.mapError(fail(`failed to create the ${input.description} client`)),
      );
      return yield* executeEnvironmentHttpRequest(
        environmentEndpointUrl(prepared.httpBaseUrl, input.path),
        THREAD_SNAPSHOT_TIMEOUT_MS,
        input.request(client, {
          authorization: `Bearer ${prepared.httpAuthorization.token}`,
          [ORCHESTRATION_PROTOCOL_HEADER]: ORCHESTRATION_PROTOCOL_VERSION_TEXT,
        }),
      ).pipe(
        Effect.provideService(HttpClient.HttpClient, httpClient),
        Effect.mapError(fail(`failed to load the ${input.description}`)),
      );
    });

  const getThreadDetailSnapshot: Orchestration["getThreadDetailSnapshot"] = (threadId) => {
    const id = ThreadId.make(threadId);
    return requestThreadSnapshot({
      threadId,
      path: `/api/orchestration/threads/${id}`,
      description: "thread snapshot",
      request: (client, headers) =>
        client.orchestration.threadSnapshot({ params: { threadId: id }, headers }),
    });
  };
  const getThreadBoundedSnapshot: Orchestration["getThreadBoundedSnapshot"] = (threadId) => {
    const id = ThreadId.make(threadId);
    return requestThreadSnapshot({
      threadId,
      path: `/api/orchestration/threads/${id}/bounded`,
      description: "thread snapshot",
      request: (client, headers) =>
        client.orchestration.threadBoundedSnapshot({ params: { threadId: id }, headers }),
    });
  };
  const getThreadHistoryPage: Orchestration["getThreadHistoryPage"] = (input) => {
    const id = ThreadId.make(input.threadId);
    return requestThreadSnapshot({
      threadId: input.threadId,
      path: `/api/orchestration/threads/${id}/history`,
      description: "thread history page",
      request: (client, headers) =>
        client.orchestration.threadHistoryPage({
          params: { threadId: id },
          query: { cursor: input.cursor },
          headers,
        }),
    });
  };

  return {
    dispatch,
    mutateProject,
    launchThread,
    getServerConfig,
    getShellSnapshot,
    getArchivedShellSnapshot,
    searchThreads,
    getThreadProjection,
    getThreadDetailSnapshot,
    getThreadBoundedSnapshot,
    getThreadHistoryPage,
    watchShellSequence,
    watchThread,
  } satisfies Orchestration;
});

export const T3OrchestrationLive = Layer.effect(T3Orchestration, makeT3Orchestration());
