import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { encryptEnvironment } from "./codec.ts";
import type { CredentialCrypto } from "./credential-service.ts";
import { migrateV1EnvironmentName, validateEnvironmentName } from "./environment-name.ts";
import { ConfigError, UrlError } from "./error.ts";
import {
  StoredConfigV1FileSchema,
  StoredConfigV2FileSchema,
  type StoredConfigV1File,
} from "./schema.ts";
import type { EncryptedConfig } from "./types.ts";
import { normalizeHttpBaseUrl } from "./url.ts";

export const emptyEncryptedConfig = (): EncryptedConfig => ({
  version: 2,
  environments: {},
});

export function readEncryptedConfigFromValue(crypto: CredentialCrypto, value: unknown) {
  return Effect.gen(function* () {
    const v2 = yield* Schema.decodeUnknownEffect(StoredConfigV2FileSchema)(value).pipe(
      Effect.option,
    );
    if (Option.isSome(v2)) {
      return { config: v2.value, migratedFromV1: false as const };
    }
    const v1 = yield* Schema.decodeUnknownEffect(StoredConfigV1FileSchema)(value);
    const migrated = yield* migrateV1FileToEncrypted(crypto, v1);
    return { config: migrated, migratedFromV1: true as const };
  }).pipe(Effect.mapError((error) => mapMigrationError(error)));
}

export function migrateV1FileToEncrypted(crypto: CredentialCrypto, config: StoredConfigV1File) {
  return Effect.gen(function* () {
    if (
      (config.url === undefined || config.url.length === 0) &&
      (config.token === undefined || config.token.length === 0)
    ) {
      return emptyEncryptedConfig();
    }
    if (config.url === undefined || config.token === undefined) {
      return yield* Effect.fail(
        new ConfigError({ message: "failed to read config: incomplete v1 credentials" }),
      );
    }
    const name = yield* migrateV1EnvironmentName(config).pipe(
      Effect.flatMap((migratedName) =>
        validateEnvironmentName(migratedName).pipe(Effect.as(migratedName)),
      ),
    );
    const normalizedUrl = yield* normalizeHttpBaseUrl(config.url);
    const token = yield* encryptEnvironment(crypto, {
      environmentName: name,
      url: normalizedUrl,
      local: config.local ?? false,
      token: config.token,
    });
    return {
      version: 2 as const,
      default: name,
      environments: {
        [name]: {
          url: normalizedUrl,
          local: config.local ?? false,
          token,
        },
      },
    } satisfies EncryptedConfig;
  });
}

function mapMigrationError(error: ConfigError | Schema.SchemaError | UrlError) {
  if (error instanceof ConfigError) {
    return error;
  }
  if (error instanceof UrlError) {
    return new ConfigError({ message: `failed to read config: ${error.message}` });
  }
  return new ConfigError({ message: "failed to read config", cause: error });
}
