import {
  makeWsRpcProtocolClient,
  type RpcSession,
  RpcSessionFactory,
} from "@t3tools/client-runtime/rpc";
import {
  ConnectionBlockedError,
  type ConnectionAttemptError,
  ConnectionTransientError,
  type PreparedConnection,
} from "@t3tools/client-runtime/connection";
import { WS_METHODS } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as RpcClient from "effect/unstable/rpc/RpcClient";
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";
import * as Socket from "effect/unstable/socket/Socket";

type SessionRpcError =
  | Effect.Error<ReturnType<RpcSession["client"][typeof WS_METHODS.serverGetConfig]>>
  | Effect.Error<ReturnType<RpcSession["client"][typeof WS_METHODS.serverProbe]>>;

const makeT3RpcSessionFactory = Effect.fn("makeT3RpcSessionFactory")(function* () {
  const webSocketConstructor = yield* Socket.WebSocketConstructor;

  const connect: RpcSessionFactory["Service"]["connect"] = Effect.fnUntraced(function* (
    connection: PreparedConnection,
  ) {
    yield* Effect.annotateCurrentSpan({
      "connection.environment.id": connection.environmentId,
    });

    const connected = yield* Deferred.make<void>();
    const disconnected = yield* Deferred.make<never, ConnectionTransientError>();
    const hooks = RpcClient.ConnectionHooks.of({
      onConnect: Deferred.succeed(connected, undefined).pipe(Effect.asVoid),
      onDisconnect: Deferred.isDone(connected).pipe(
        Effect.flatMap((wasConnected) =>
          Deferred.fail(
            disconnected,
            new ConnectionTransientError({
              reason: "transport",
              detail: wasConnected
                ? `${connection.label} disconnected.`
                : `${connection.label} could not establish a WebSocket connection.`,
            }),
          ),
        ),
        Effect.asVoid,
      ),
    });
    const socketLayer = Socket.layerWebSocket(connection.socketUrl, {
      openTimeout: "15 seconds",
    }).pipe(Layer.provide(Layer.succeed(Socket.WebSocketConstructor, webSocketConstructor)));
    const protocolLayer = Layer.effect(
      RpcClient.Protocol,
      RpcClient.makeProtocolSocket({
        retryTransientErrors: false,
        retryPolicy: Schedule.recurs(0),
      }),
    ).pipe(
      Layer.provide(
        Layer.mergeAll(
          socketLayer,
          RpcSerialization.layerJson,
          Layer.succeed(RpcClient.ConnectionHooks, hooks),
        ),
      ),
    );
    const protocolContext = yield* Layer.build(protocolLayer).pipe(
      Effect.withSpan("environment.websocket.connect"),
    );
    const client = yield* makeWsRpcProtocolClient.pipe(Effect.provide(protocolContext));
    const initialConfig = yield* Effect.cached(
      client[WS_METHODS.serverGetConfig]({}).pipe(
        catchSessionRpcErrors,
        Effect.withSpan("environment.initialSync"),
      ),
    );
    const probe = initialConfig.pipe(
      Effect.flatMap((config) =>
        Effect.gen(function* () {
          if (config.environment.capabilities.connectionProbe === true) {
            return yield* client[WS_METHODS.serverProbe]({});
          }
          return yield* client[WS_METHODS.serverGetConfig]({});
        }).pipe(catchSessionRpcErrors),
      ),
      Effect.asVoid,
      Effect.withSpan("clientRuntime.connection.rpcSession.probe"),
    );

    return {
      client,
      initialConfig,
      ready: Deferred.await(connected).pipe(
        Effect.andThen(initialConfig),
        Effect.asVoid,
        Effect.raceFirst(Deferred.await(disconnected)),
      ),
      probe,
      closed: Deferred.await(disconnected),
    } satisfies RpcSession;
  });

  return RpcSessionFactory.of({ connect });
});

export const T3RpcSessionFactoryLive = Layer.effect(RpcSessionFactory, makeT3RpcSessionFactory());

function catchSessionRpcErrors<A, R>(
  effect: Effect.Effect<A, SessionRpcError, R>,
): Effect.Effect<A, ConnectionAttemptError, R> {
  return effect.pipe(
    Effect.catchTags({
      EnvironmentAuthorizationError: (error) =>
        Effect.fail(
          new ConnectionBlockedError({
            reason: "permission",
            detail: error.message,
          }),
        ),
      KeybindingsConfigParseError: (error) =>
        Effect.fail(
          new ConnectionTransientError({
            reason: "remote-unavailable",
            detail: error.message,
          }),
        ),
      ServerSettingsError: (error) =>
        Effect.fail(
          new ConnectionTransientError({
            reason: "remote-unavailable",
            detail: error.message,
          }),
        ),
      RpcClientError: (error) =>
        Effect.fail(
          new ConnectionTransientError({
            reason: "transport",
            detail: error.message,
          }),
        ),
    }),
  );
}
