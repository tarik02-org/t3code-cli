import * as Effect from "effect/Effect";

import type {
  CredentialCrypto,
  CredentialDecryptInput,
  CredentialEncryptInput,
} from "./credential-service.ts";
import type { EncryptedConfig, DecryptedConfig, DecryptedEnvironment } from "./types.ts";

export function encryptEnvironment(crypto: CredentialCrypto, input: CredentialEncryptInput) {
  return crypto.encrypt(input);
}

export function decryptEnvironment(crypto: CredentialCrypto, input: CredentialDecryptInput) {
  return crypto.decrypt(input);
}

export function decryptConfig(crypto: CredentialCrypto, config: EncryptedConfig) {
  return Effect.gen(function* () {
    const environments: Record<string, DecryptedEnvironment> = {};
    for (const [name, environmentConfig] of Object.entries(config.environments)) {
      environments[name] = {
        url: environmentConfig.url,
        local: environmentConfig.local,
        token: yield* decryptEnvironment(crypto, {
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
}

export function encryptConfig(crypto: CredentialCrypto, config: DecryptedConfig) {
  return Effect.gen(function* () {
    const environments: Record<string, EncryptedConfig["environments"][string]> = {};
    for (const [name, environmentConfig] of Object.entries(config.environments)) {
      environments[name] = {
        url: environmentConfig.url,
        local: environmentConfig.local,
        token: yield* encryptEnvironment(crypto, {
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
}
