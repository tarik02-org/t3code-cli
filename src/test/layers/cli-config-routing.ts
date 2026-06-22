import * as Layer from "effect/Layer";

import { T3CliConfigSelectionLive } from "../../cli/selection-layer.ts";
import { layer as T3CredentialCryptoLive } from "../../config/credential.ts";
import { layer as T3ConfigLive } from "../../config/layer.ts";
import { layerNode as T3CredentialCipherNodeLive } from "../../config/credential-cipher-node.ts";
import { Environment } from "../../environment/service.ts";
import { ConfigPlatformLayer } from "../platform.ts";
import { unavailableKeystoreFactoryLayer } from "./keystore-unavailable.ts";

export function cliConfigRoutingLayerTest(homeDir: string) {
  const environmentLayer = Environment.layerTest({
    homeDir,
    env: { T3CLI_ENV: "home" },
  });

  return Layer.mergeAll(
    ConfigPlatformLayer,
    environmentLayer,
    T3ConfigLive.pipe(
      Layer.provide(T3CredentialCryptoLive),
      Layer.provide(
        Layer.mergeAll(
          environmentLayer,
          T3CliConfigSelectionLive.pipe(Layer.provide(environmentLayer)),
          T3CredentialCipherNodeLive,
          unavailableKeystoreFactoryLayer,
        ),
      ),
    ),
  );
}
