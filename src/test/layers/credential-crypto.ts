import * as Layer from "effect/Layer";

import { layer as T3CredentialCryptoLive } from "../../config/credential.ts";
import { layerWeb as T3CredentialCipherWebLive } from "../../config/credential-cipher-web.ts";
import { Environment } from "../../environment/service.ts";
import { ConfigPlatformLayer } from "../platform.ts";
import { unavailableKeystoreFactoryLayer } from "./keystore-unavailable.ts";

export function t3CredentialCryptoDepsLayer(homeDir: string) {
  return T3CredentialCryptoLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        Environment.layerTest({ homeDir }),
        T3CredentialCipherWebLive,
        unavailableKeystoreFactoryLayer,
      ),
    ),
  );
}

export function t3CredentialCryptoLayerTest(homeDir: string) {
  return Layer.mergeAll(ConfigPlatformLayer, t3CredentialCryptoDepsLayer(homeDir));
}
