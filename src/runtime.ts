import * as Layer from "effect/Layer";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeSocket from "@effect/platform-node/NodeSocket";

import { T3AuthLive } from "./auth/layer.ts";
import { T3LocalAuthLive } from "./auth/local.ts";
import { T3AuthPairingLive } from "./auth/pairing.ts";
import { T3AuthTransportLive } from "./auth/transport.ts";
import { T3ConfigLive } from "./config/layer.ts";
import { T3ApplicationLive } from "./application/layer.ts";
import { T3OrchestrationLive } from "./orchestration/layer.ts";
import { T3RpcLive } from "./rpc/layer.ts";
import { NodeSqlClientFactoryLive } from "./sql/node-sqlite-client.ts";

const T3AuthTransportLayer = T3AuthTransportLive.pipe(Layer.provide(NodeHttpClient.layerUndici));
const T3LocalAuthLayer = T3LocalAuthLive.pipe(
  Layer.provide(Layer.mergeAll(T3ConfigLive, NodeSqlClientFactoryLive)),
);
const T3AuthPairingLayer = T3AuthPairingLive.pipe(
  Layer.provide(Layer.mergeAll(T3ConfigLive, T3AuthTransportLayer)),
);
const T3AuthLayer = T3AuthLive.pipe(
  Layer.provide(
    Layer.mergeAll(T3ConfigLive, T3AuthTransportLayer, T3LocalAuthLayer, T3AuthPairingLayer),
  ),
);
const T3RpcLayer = T3RpcLive.pipe(
  Layer.provide(Layer.mergeAll(T3ConfigLive, T3AuthLayer, NodeSocket.layerWebSocketConstructor)),
);
const T3OrchestrationLayer = T3OrchestrationLive.pipe(Layer.provide(T3RpcLayer));
const T3ApplicationLayer = T3ApplicationLive.pipe(
  Layer.provide(Layer.mergeAll(T3RpcLayer, T3OrchestrationLayer)),
);

export const AuthAppLayer = Layer.mergeAll(T3ConfigLive, T3AuthLayer);

export const AppLayer = Layer.mergeAll(
  T3ConfigLive,
  T3AuthLayer,
  T3RpcLayer,
  T3OrchestrationLayer,
  T3ApplicationLayer,
);
