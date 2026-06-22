import * as Layer from "effect/Layer";

import { CliRuntime } from "../../cli/runtime/service.ts";
import { ConfigPlatformLayer } from "../platform.test-utils.ts";
import { t3CliEnvConfigLayer } from "../env/env.test-utils.ts";
import * as CredentialCipherWeb from "./cipher-web.ts";
import * as Keystore from "../keystore/service.test-utils.ts";
import * as Credential from "./service.ts";

export function t3CredentialCryptoDepsLayer(homeDir: string) {
  return Credential.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        CliRuntime.layerTest({ cwd: homeDir }),
        t3CliEnvConfigLayer(homeDir),
        CredentialCipherWeb.layerWeb,
        Keystore.unavailableKeystoreFactoryLayer,
      ),
    ),
  );
}

export function t3CredentialCryptoLayerTest(homeDir: string) {
  return Layer.mergeAll(ConfigPlatformLayer, t3CredentialCryptoDepsLayer(homeDir));
}
