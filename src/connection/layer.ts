import * as Layer from "effect/Layer";

import { T3PreparedConnectionProviderLive } from "./prepared.ts";
import { T3RpcLive } from "../rpc/layer.ts";
import { T3RpcSessionFactoryLive } from "../rpc/session.ts";

export function makeT3CodeRpcLayer() {
  return T3RpcLive.pipe(
    Layer.provide(Layer.mergeAll(T3PreparedConnectionProviderLive, T3RpcSessionFactoryLive)),
  );
}

export const T3CodeRpcLayer = makeT3CodeRpcLayer();
