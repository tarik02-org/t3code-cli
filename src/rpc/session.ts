import {
  makeWsRpcProtocolClient,
  type RpcSession,
  RpcSessionFactory,
} from "@t3tools/client-runtime/rpc";
import {
  ConnectionBlockedError,
  type ConnectionAttemptError,
  type ConnectionTransientError,
  ConnectionTransientError as ConnectionTransientErrorClass,
  type PreparedConnection,
} from "@t3tools/client-runtime/connection";
import { WS_METHODS } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import * as Schedule from "effect/Schedule";
import * as RpcClient from "effect/unstable/rpc/RpcClient";
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";
import * as Socket from "effect/unstable/socket/Socket";

type InitialConfigError = Effect.Error<
  ReturnType<Awaited<RpcSession["client"]>[typeof WS_METHODS.serverGetConfig]>
>;

export const T3RpcSessionFactoryLive = Layer.effect(
  RpcSessionFactory,
  Effect.gen(function* () {
    const webSocketConstructor = yield* Socket.WebSocketConstructor;

    const connect: RpcSessionFactory["Service"]["connect"] = Effect.fnUntraced(function* (
      connection: PreparedConnection,
    ) {
      const connected = yield* Deferred.make<void>();
      const disconnected = yield* Deferred.make<never, ConnectionTransientError>();
      const hooks = RpcClient.ConnectionHooks.of({
        onConnect: Deferred.succeed(connected, undefined).pipe(Effect.asVoid),
        onDisconnect: Deferred.isDone(connected).pipe(
          Effect.flatMap((wasConnected) =>
            Deferred.fail(
              disconnected,
              new ConnectionTransientErrorClass({
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
      const protocolContext = yield* Layer.build(protocolLayer);
      const client = yield* makeWsRpcProtocolClient.pipe(Effect.provide(protocolContext));
      const initialConfig = yield* Effect.cached(
        client[WS_METHODS.serverGetConfig]({}).pipe(Effect.mapError(mapInitialConfigError)),
      );
      const probe = client[WS_METHODS.serverGetConfig]({}).pipe(
        Effect.mapError(mapInitialConfigError),
        Effect.asVoid,
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
  }),
);

function mapInitialConfigError(error: InitialConfigError): ConnectionAttemptError {
  if (Predicate.isTagged(error, "EnvironmentAuthorizationError")) {
    return new ConnectionBlockedError({
      reason: "permission",
      detail: error.message,
    });
  }
  if (Predicate.isTagged(error, "RpcClientError")) {
    return new ConnectionTransientErrorClass({
      reason: "transport",
      detail: error.message,
    });
  }
  return new ConnectionTransientErrorClass({
    reason: "remote-unavailable",
    detail: error.message,
  });
}
