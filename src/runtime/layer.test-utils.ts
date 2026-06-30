import * as Layer from "effect/Layer";

import * as CliSelection from "../cli/env/selection-layer.ts";
import * as CliRuntime from "../cli/runtime/service.ts";
import * as Config from "../config/config.ts";
import * as Credential from "../config/credential/service.ts";
import * as CredentialCipherNode from "../config/credential/cipher-node.ts";
import { ConfigPlatformLayer } from "../config/platform.test-utils.ts";
import { t3CliEnvConfigLayer } from "../config/env/env.test-utils.ts";
import * as Keystore from "../config/keystore/service.test-utils.ts";

export function cliConfigRoutingLayerTest(homeDir: string) {
  const cliRuntimeLayer = CliRuntime.CliRuntime.layerTest({ cwd: homeDir });
  const configLayer = t3CliEnvConfigLayer(homeDir, { T3CLI_ENV: "home" });
  const platformEnvLayer = Layer.mergeAll(cliRuntimeLayer, configLayer);

  return Layer.mergeAll(
    ConfigPlatformLayer,
    platformEnvLayer,
    Config.layer.pipe(
      Layer.provide(Credential.layer),
      Layer.provide(
        Layer.mergeAll(
          platformEnvLayer,
          CliSelection.layer.pipe(Layer.provide(platformEnvLayer)),
          CredentialCipherNode.layerNode,
          Keystore.unavailableKeystoreFactoryLayer,
        ),
      ),
    ),
  );
}
