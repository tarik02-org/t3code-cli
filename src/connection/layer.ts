import * as Layer from "effect/Layer";

import { T3AuthTransportLive } from "../auth/transport.ts";
import { T3RpcLive } from "../rpc/layer.ts";

export function makeT3CodeRpcLayer() {
  return T3RpcLive.pipe(Layer.provide(T3AuthTransportLive));
}

export const T3CodeRpcLayer = makeT3CodeRpcLayer();
