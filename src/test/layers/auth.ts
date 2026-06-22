import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { T3AuthLive } from "../../auth/layer.ts";
import { T3LocalAuth } from "../../auth/local.ts";
import { T3AuthPairing } from "../../auth/pairing.ts";
import { T3AuthTransport } from "../../auth/transport.ts";
import { t3ConfigDepsLayer } from "./config.ts";
import { ConfigPlatformLayer } from "../platform.ts";

export function t3AuthDepsLayer(homeDir: string) {
  return T3AuthLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        t3ConfigDepsLayer(homeDir),
        Layer.succeed(T3AuthTransport)({
          bootstrapBearer: () => Effect.die("unused in test"),
          getSession: () => Effect.succeed({ authenticated: false }),
          issueWebSocketTicket: () => Effect.die("unused in test"),
        }),
        Layer.succeed(T3LocalAuth)({
          local: () => Effect.die("unused in test"),
        }),
        Layer.succeed(T3AuthPairing)({
          pair: () => Effect.die("unused in test"),
        }),
      ),
    ),
  );
}

export function t3AuthLayerTest(homeDir: string) {
  return Layer.mergeAll(ConfigPlatformLayer, t3AuthDepsLayer(homeDir));
}
