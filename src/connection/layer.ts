import { rpcSessionFactoryLayer } from "@t3tools/client-runtime/rpc";
import * as Layer from "effect/Layer";

import { T3PreparedConnectionProviderLive } from "./prepared.ts";
import { T3RpcLive } from "../rpc/layer.ts";

export function makeT3CodeRpcLayer() {
  return T3RpcLive.pipe(
    Layer.provide(Layer.mergeAll(T3PreparedConnectionProviderLive, rpcSessionFactoryLayer)),
  );
}

export const T3CodeRpcLayer = makeT3CodeRpcLayer();
