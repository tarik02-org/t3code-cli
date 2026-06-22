import * as Layer from "effect/Layer";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeSocket from "@effect/platform-node/NodeSocket";

import { T3CodeRpcLayer } from "../connection/index.ts";

const NodeConnectionPlatformLayer = Layer.mergeAll(
  NodeHttpClient.layerUndici,
  NodeSocket.layerWebSocketConstructor,
);

export const T3CodeNodeRpcLayer = T3CodeRpcLayer.pipe(Layer.provide(NodeConnectionPlatformLayer));
