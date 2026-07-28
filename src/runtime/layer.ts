import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeSocket from "@effect/platform-node/NodeSocket";

import { T3ApplicationLive } from "../application/layer.ts";
import { T3AuthLive } from "../auth/layer.ts";
import { T3LocalAuthLive } from "../auth/local.ts";
import { T3LocalAuthOriginLive } from "../auth/local-origin.ts";
import { T3LocalAuthTokenLive } from "../auth/local-token.ts";
import { T3AuthPairingLive } from "../auth/pairing.ts";
import { T3AuthTransportLive } from "../auth/transport.ts";
import * as Config from "../config/config.ts";
import * as Credential from "../config/credential/service.ts";
import * as Selection from "../config/selection/service.ts";
import { T3CodeConnectionError } from "../connection/error.ts";
import { T3PreparedConnectionProviderLive } from "../connection/prepared.ts";
import { T3CodeConnectionProvider, makeT3CodeConnectionProvider } from "../connection/service.ts";
import { T3OrchestrationLive } from "../orchestration/layer.ts";
import { T3RpcLive } from "../rpc/layer.ts";
import { T3RpcOperationsLive } from "../rpc/operation.ts";
import { T3RpcSessionFactoryLive } from "../rpc/session.ts";
import { NodeSqlClientFactoryLive } from "../sql/node-sqlite-client.ts";
import { NodeCliPathLayer } from "../cli-path/layer.ts";

export const T3ConfigLayer = Config.layer.pipe(Layer.provide(Credential.layer));
export const T3AuthTransportLayer = T3AuthTransportLive.pipe(
  Layer.provide(NodeHttpClient.layerUndici),
);
export const T3LocalAuthOriginLayer = T3LocalAuthOriginLive;
export const T3LocalAuthTokenLayer = T3LocalAuthTokenLive.pipe(
  Layer.provide(NodeSqlClientFactoryLive),
);
export const T3LocalAuthLayer = T3LocalAuthLive.pipe(
  Layer.provide(Layer.mergeAll(T3LocalAuthOriginLayer, T3LocalAuthTokenLayer)),
);
export const T3AuthPairingLayer = T3AuthPairingLive.pipe(Layer.provide(T3AuthTransportLayer));
export const T3AuthLayer = T3AuthLive.pipe(
  Layer.provide(
    Layer.mergeAll(T3ConfigLayer, T3AuthTransportLayer, T3LocalAuthLayer, T3AuthPairingLayer),
  ),
);
const T3ConfigConnectionProviderLayer = Layer.effect(
  T3CodeConnectionProvider,
  Effect.gen(function* () {
    const config = yield* Config.T3Config;
    return makeT3CodeConnectionProvider(
      config.resolve().pipe(
        Effect.map((resolved) => ({
          origin: { url: resolved.url },
          auth: { token: resolved.token },
        })),
        Effect.mapError(
          (error) =>
            new T3CodeConnectionError({
              message: "failed to resolve T3 Code connection from CLI config",
              cause: error,
            }),
        ),
      ),
    );
  }),
).pipe(Layer.provide(T3ConfigLayer));

const T3RpcLayer = T3RpcLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      T3PreparedConnectionProviderLive.pipe(
        Layer.provide(Layer.mergeAll(T3ConfigConnectionProviderLayer, NodeHttpClient.layerUndici)),
      ),
      T3RpcSessionFactoryLive.pipe(Layer.provide(NodeSocket.layerWebSocketConstructor)),
    ),
  ),
);
const T3RpcOperationsLayer = T3RpcOperationsLive.pipe(Layer.provide(T3RpcLayer));
export const T3OrchestrationLayer = T3OrchestrationLive.pipe(Layer.provide(T3RpcOperationsLayer));
const T3ApplicationLayer = T3ApplicationLive.pipe(
  Layer.provide(Layer.mergeAll(T3RpcOperationsLayer, T3OrchestrationLayer)),
);

export const BaseAppLayer = Layer.mergeAll(
  T3ConfigLayer,
  T3AuthLayer,
  T3RpcLayer,
  T3RpcOperationsLayer,
  T3OrchestrationLayer,
  T3ApplicationLayer,
  NodeCliPathLayer,
);

export const BaseAuthAppLayer = Layer.mergeAll(T3ConfigLayer, T3AuthLayer);

export const AuthAppLayer = BaseAuthAppLayer.pipe(Layer.provideMerge(Selection.layer));

export const AppLayer = BaseAppLayer.pipe(Layer.provideMerge(Selection.layer));
