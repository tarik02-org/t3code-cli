import * as Layer from "effect/Layer";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeSocket from "@effect/platform-node/NodeSocket";

import { T3AuthLive } from "./auth/layer.ts";
import { T3ConfigLive } from "./config/layer.ts";
import { T3DomainLive } from "./domain/layer.ts";
import { T3OrchestrationLive } from "./orchestration/layer.ts";
import { T3RpcLive } from "./rpc/layer.ts";

const T3AuthLayer = T3AuthLive.pipe(
  Layer.provide(Layer.mergeAll(T3ConfigLive, NodeHttpClient.layerUndici)),
);
const T3RpcLayer = T3RpcLive.pipe(
  Layer.provide(Layer.mergeAll(T3ConfigLive, T3AuthLayer, NodeSocket.layerWebSocketConstructor)),
);
const T3OrchestrationLayer = T3OrchestrationLive.pipe(Layer.provide(T3RpcLayer));
const T3DomainLayer = T3DomainLive.pipe(Layer.provide(T3OrchestrationLayer));

export const AuthAppLayer = Layer.mergeAll(T3ConfigLive, T3AuthLayer);

export const AppLayer = Layer.mergeAll(
  T3ConfigLive,
  T3AuthLayer,
  T3RpcLayer,
  T3OrchestrationLayer,
  T3DomainLayer,
);
