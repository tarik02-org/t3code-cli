import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Filter from "effect/Filter";
import type * as Path from "effect/Path";

import type { CredentialCrypto } from "./credential-service.ts";
import { ConfigError } from "./error.ts";
import { hardenPrivateFileMode } from "./file-mode.ts";
import { emptyEncryptedConfig, readEncryptedConfigFromValue } from "./migration.ts";
import type { EncryptedConfig } from "./types.ts";

export function readEncryptedConfigFile(
  fs: FileSystem.FileSystem,
  path: Path.Path,
  configFilePath: string,
  crypto: CredentialCrypto,
) {
  return Effect.gen(function* () {
    const raw = yield* fs.readFileString(configFilePath).pipe(
      Effect.catchFilter(Filter.reason("PlatformError", "NotFound"), () =>
        Effect.succeed(undefined),
      ),
      Effect.mapError(
        (error) => new ConfigError({ message: "failed to read config", cause: error }),
      ),
    );
    if (raw === undefined) {
      return emptyEncryptedConfig();
    }
    const value = yield* Effect.try({
      try: () => JSON.parse(raw) as unknown,
      catch: () => new ConfigError({ message: "failed to read config" }),
    });
    const read = yield* readEncryptedConfigFromValue(crypto, value);
    if (read.migratedFromV1) {
      yield* writeEncryptedConfigFile(fs, path, configFilePath, read.config);
    }
    return read.config;
  });
}

export function writeEncryptedConfigFile(
  fs: FileSystem.FileSystem,
  path: Path.Path,
  configFilePath: string,
  config: EncryptedConfig,
) {
  return Effect.gen(function* () {
    yield* fs
      .makeDirectory(path.dirname(configFilePath), { recursive: true, mode: 0o700 })
      .pipe(
        Effect.mapError(
          (error) => new ConfigError({ message: "failed to write config", cause: error }),
        ),
      );
    yield* fs
      .writeFileString(configFilePath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
      .pipe(
        Effect.mapError(
          (error) => new ConfigError({ message: "failed to write config", cause: error }),
        ),
      );
    yield* hardenPrivateFileMode(fs, configFilePath, "config");
  });
}
