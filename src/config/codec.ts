import * as Effect from "effect/Effect";

import { T3CredentialCrypto } from "./credential.ts";
import type { EncryptedConfig, DecryptedConfig, DecryptedEnvironment } from "./types.ts";

export const decryptConfig = Effect.fn("decryptConfig")(function* (config: EncryptedConfig) {
  const crypto = yield* T3CredentialCrypto;
  const environments: Record<string, DecryptedEnvironment> = {};
  for (const [name, environmentConfig] of Object.entries(config.environments)) {
    environments[name] = {
      url: environmentConfig.url,
      local: environmentConfig.local,
      token: yield* crypto.decrypt({
        environmentName: name,
        url: environmentConfig.url,
        local: environmentConfig.local,
        token: environmentConfig.token,
      }),
    };
  }
  return {
    version: 2 as const,
    ...(config.default !== undefined ? { default: config.default } : {}),
    environments,
  } satisfies DecryptedConfig;
});

export const encryptConfig = Effect.fn("encryptConfig")(function* (config: DecryptedConfig) {
  const crypto = yield* T3CredentialCrypto;
  const environments: Record<string, EncryptedConfig["environments"][string]> = {};
  for (const [name, environmentConfig] of Object.entries(config.environments)) {
    environments[name] = {
      url: environmentConfig.url,
      local: environmentConfig.local,
      token: yield* crypto.encrypt({
        environmentName: name,
        url: environmentConfig.url,
        local: environmentConfig.local,
        token: environmentConfig.token,
      }),
    };
  }
  return {
    version: 2 as const,
    ...(config.default !== undefined ? { default: config.default } : {}),
    environments,
  } satisfies EncryptedConfig;
});
