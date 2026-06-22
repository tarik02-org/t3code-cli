import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { catchPlatformError, catchPlatformErrorUnlessNotFound, catchSchemaError } from "./error.ts";
import { hardenPrivateFileMode } from "./file-mode.ts";
import { emptyEncryptedConfig, readEncryptedConfigFromValue } from "./migration.ts";
import { resolveConfigFilePath } from "./paths.ts";
import { UnknownConfigFileJson, StoredConfigV2FileJson } from "./schema.ts";
import type { EncryptedConfig } from "./types.ts";

export const readEncryptedConfigFile = Effect.fn("readEncryptedConfigFile")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const configFilePath = yield* resolveConfigFilePath();
  const raw = yield* fs
    .readFileString(configFilePath)
    .pipe(Effect.catchTags(catchPlatformErrorUnlessNotFound("failed to read config")));
  if (raw === undefined) {
    return emptyEncryptedConfig();
  }
  const value = yield* Schema.decodeUnknownEffect(UnknownConfigFileJson)(raw).pipe(
    Effect.catchTags(catchSchemaError("failed to read config")),
  );
  const read = yield* readEncryptedConfigFromValue(value);
  if (read.migratedFromV1) {
    yield* writeEncryptedConfigFile(read.config);
  }
  return read.config;
});

export const writeEncryptedConfigFile = Effect.fn("writeEncryptedConfigFile")(function* (
  config: EncryptedConfig,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const configFilePath = yield* resolveConfigFilePath();
  yield* fs
    .makeDirectory(path.dirname(configFilePath), { recursive: true, mode: 0o700 })
    .pipe(Effect.catchTags(catchPlatformError("failed to write config")));
  const encoded = yield* Schema.encodeEffect(StoredConfigV2FileJson)(config).pipe(
    Effect.catchTags(catchSchemaError("failed to write config")),
  );
  yield* fs
    .writeFileString(configFilePath, `${encoded}\n`, { mode: 0o600 })
    .pipe(Effect.catchTags(catchPlatformError("failed to write config")));
  yield* hardenPrivateFileMode(configFilePath, "config");
});
