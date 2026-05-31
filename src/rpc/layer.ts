import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as SynchronizedRef from "effect/SynchronizedRef";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import { HttpClientRequest } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import * as Socket from "effect/unstable/socket/Socket";

import { T3Auth } from "../auth/service.ts";
import { T3Config } from "../config/service.ts";
import { toWebSocketBaseUrl } from "../config/url.ts";
import { WsRpcGroup } from "../protocol/schema.ts";
import { RpcError } from "./error.ts";
import { T3Rpc, type WsClient } from "./service.ts";

const makeClient = RpcClient.make(WsRpcGroup);

type Connection = {
  readonly scope: Scope.Closeable;
  readonly client: WsClient;
};

export const makeT3RpcLayer = Effect.fn("makeT3RpcLayer")(function* () {
  const config = yield* T3Config;
  const auth = yield* T3Auth;
  const parentScope = yield* Scope.Scope;
  const connection = yield* SynchronizedRef.make(Option.none<Connection>());
  const openConnection = Effect.fn("T3RpcLive.openConnection")(function* () {
    const scope = yield* Scope.fork(parentScope);
    return yield* Effect.gen(function* () {
      const url = yield* makeWsUrl({ auth, config });
      const protocol = yield* Layer.buildWithScope(makeProtocolLayer(url), scope);
      const client = yield* makeClient.pipe(
        Effect.provide(protocol),
        Effect.provideService(Scope.Scope, scope),
      );
      return { scope, client } satisfies Connection;
    }).pipe(
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
  readonly config: T3Config["Service"];
  readonly auth: T3Auth["Service"];
}) {
  const resolved = yield* input.config.resolve();
  const wsToken = yield* input.auth.issueWebSocketToken();
  const wsUrl = yield* toWebSocketBaseUrl(resolved.url);
  const request = HttpClientRequest.get(wsUrl).pipe(
    HttpClientRequest.setUrlParam("wsToken", wsToken.token),
  );
  return Option.getOrThrow(HttpClientRequest.toUrl(request)).toString();
});

function makeProtocolLayer(url: string) {
  const socketLayer = Socket.layerWebSocket(url).pipe(
    Layer.provide(NodeSocket.layerWebSocketConstructor),
  );
  return RpcClient.layerProtocolSocket({ retryTransientErrors: true }).pipe(
    Layer.provide(socketLayer),
    Layer.provide(RpcSerialization.layerJson),
  );
}

export const T3RpcLive = Layer.effectContext(
  makeT3RpcLayer().pipe(Effect.map((rpc) => Context.make(T3Rpc, rpc))),
);
