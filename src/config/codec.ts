import * as Effect from "effect/Effect";

import {
  T3CredentialCrypto,
  type CredentialDecryptInput,
  type CredentialEncryptInput,
} from "./credential-service.ts";
import type { EncryptedConfig, DecryptedConfig, DecryptedEnvironment } from "./types.ts";

export const encryptEnvironment = Effect.fn("encryptEnvironment")(function* (
  input: CredentialEncryptInput,
) {
  const crypto = yield* T3CredentialCrypto;
  return yield* crypto.encrypt(input);
});

export const decryptEnvironment = Effect.fn("decryptEnvironment")(function* (
  input: CredentialDecryptInput,
) {
  const crypto = yield* T3CredentialCrypto;
  return yield* crypto.decrypt(input);
});

export const decryptConfig = Effect.fn("decryptConfig")(function* (config: EncryptedConfig) {
  const environments: Record<string, DecryptedEnvironment> = {};
  for (const [name, environmentConfig] of Object.entries(config.environments)) {
    environments[name] = {
      url: environmentConfig.url,
      local: environmentConfig.local,
      token: yield* decryptEnvironment({
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
  const environments: Record<string, EncryptedConfig["environments"][string]> = {};
  for (const [name, environmentConfig] of Object.entries(config.environments)) {
    environments[name] = {
      url: environmentConfig.url,
      local: environmentConfig.local,
      token: yield* encryptEnvironment({
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
