import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { T3AuthLive } from "./layer.ts";
import { T3LocalAuth } from "./local.ts";
import { T3AuthPairing } from "./pairing.ts";
import { T3AuthTransport } from "./transport.ts";
import { t3ConfigDepsLayer } from "../config/layer.test-utils.ts";
import { ConfigPlatformLayer } from "../config/platform.test-utils.ts";

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
