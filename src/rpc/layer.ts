import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";
import * as SynchronizedRef from "effect/SynchronizedRef";
import { HttpClientRequest } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import * as Socket from "effect/unstable/socket/Socket";

import { T3AuthTransport } from "../auth/transport.ts";
import { T3CodeConnectionProvider } from "../connection/service.ts";
import { normalizeHttpBaseUrl, toWebSocketEndpointUrl } from "../config/url/url.ts";
import { CliWsRpcGroup } from "./ws-group.ts";
import { RpcError } from "./error.ts";
import { T3Rpc, type WsClient } from "./service.ts";

const makeClient = RpcClient.make(CliWsRpcGroup);
const connectionRetrySchedule = Schedule.exponential("100 millis").pipe(Schedule.take(4));

type Connection = {
  readonly scope: Scope.Closeable;
  readonly client: WsClient;
};

export const makeT3RpcLayer = Effect.fn("makeT3RpcLayer")(function* () {
  const connectionProvider = yield* T3CodeConnectionProvider;
  const authTransport = yield* T3AuthTransport;
  const webSocketConstructor = yield* Socket.WebSocketConstructor;
  const parentScope = yield* Scope.Scope;
  const connection = yield* SynchronizedRef.make(Option.none<Connection>());
  const openConnection = Effect.fn("T3RpcLive.openConnection")(function* () {
    const scope = yield* Scope.fork(parentScope);
    return yield* Effect.gen(function* () {
      const url = yield* makeWsUrl({ authTransport, connectionProvider });
      const protocol = yield* Layer.buildWithScope(
        makeProtocolLayer(url, webSocketConstructor),
        scope,
      );
      const client = yield* makeClient.pipe(
        Effect.provide(protocol),
        Effect.provideService(Scope.Scope, scope),
      );
      return { scope, client } satisfies Connection;
    }).pipe(
      Effect.retry(connectionRetrySchedule),
      Effect.onError(() => Scope.close(scope, Exit.void)),
      Effect.mapError((error) => new RpcError({ message: error.message, cause: error })),
    );
  });

  const disconnect = Effect.fn("T3RpcLive.disconnect")(function* () {
    const current = yield* SynchronizedRef.getAndSet(connection, Option.none<Connection>());
    if (Option.isSome(current)) {
      yield* Scope.close(current.value.scope, Exit.void);
    }
  });

  const getClient = Effect.fn("T3RpcLive.getClient")(function* () {
    return yield* SynchronizedRef.modifyEffect(connection, (current) => {
      if (Option.isSome(current)) {
        return Effect.succeed([current.value.client, current] as const);
      }
      return openConnection().pipe(Effect.map((next) => [next.client, Option.some(next)] as const));
    });
  });

  return {
    getClient: getClient(),
    disconnect: disconnect(),
    reconnect: disconnect().pipe(Effect.andThen(getClient())),
  };
});

const makeWsUrl = Effect.fn("makeWsUrl")(function* (input: {
  readonly authTransport: T3AuthTransport["Service"];
  readonly connectionProvider: T3CodeConnectionProvider["Service"];
}) {
  const connection = yield* input.connectionProvider.get;
  const origin = yield* normalizeHttpBaseUrl(connection.origin.url);
  const wsTicket = yield* input.authTransport.issueWebSocketTicket({
    url: origin,
    token: connection.auth.token,
  });
  const wsUrl = yield* toWebSocketEndpointUrl(origin, "/ws");
  const request = HttpClientRequest.get(wsUrl).pipe(
    HttpClientRequest.setUrlParam("wsTicket", wsTicket.ticket),
  );
  return Option.getOrThrow(HttpClientRequest.toUrl(request)).toString();
});

function makeProtocolLayer(
  url: string,
  webSocketConstructor: Socket.WebSocketConstructor["Service"],
) {
  const socketLayer = Socket.layerWebSocket(url).pipe(
    Layer.provide(Layer.succeed(Socket.WebSocketConstructor, webSocketConstructor)),
  );
  return RpcClient.layerProtocolSocket({ retryTransientErrors: true }).pipe(
    Layer.provide(socketLayer),
    Layer.provide(RpcSerialization.layerJson),
  );
}

export const T3RpcLive = Layer.effectContext(
  makeT3RpcLayer().pipe(Effect.map((rpc) => Context.make(T3Rpc, rpc))),
);
