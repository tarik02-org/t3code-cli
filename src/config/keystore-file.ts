import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  catchPlatformError,
  catchPlatformErrorUnlessNotFound,
  ConfigError,
  mapPlatformErrorToConfigError,
} from "./error.ts";
import {
  masterKeyByteLength,
  type MasterKeyKeystore,
  type MasterKeyReadResult,
} from "./keystore.ts";
import { resolveKeyFilePath } from "./paths.ts";

const privateFileMode = 0o600;

export const makeFileKeystore = Effect.fn("makeFileKeystore")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const keyFilePath = yield* resolveKeyFilePath();

  const read = (): Effect.Effect<MasterKeyReadResult, ConfigError> =>
    Effect.gen(function* () {
      const raw = yield* fs
        .readFileString(keyFilePath)
        .pipe(
          Effect.catchTags(catchPlatformErrorUnlessNotFound("failed to read credential key file")),
        );
      if (raw === undefined) {
        return { kind: "missing" };
      }
      const key = yield* Effect.fromResult(Encoding.decodeBase64(raw.trim())).pipe(
        Effect.catchTags({
          EncodingError: (error) =>
            Effect.fail(
              new ConfigError({
                message: "invalid credential key file: invalid base64",
                cause: error,
              }),
            ),
        }),
      );
      if (key.byteLength !== masterKeyByteLength) {
        return yield* Effect.fail(
          new ConfigError({ message: "invalid credential key file: unexpected key length" }),
        );
      }
      yield* fs
        .chmod(keyFilePath, privateFileMode)
        .pipe(
          Effect.mapError(
            mapPlatformErrorToConfigError("failed to set credential key file permissions"),
          ),
        );
      return { kind: "present", key };
    });

  const write = (key: Uint8Array): Effect.Effect<void, ConfigError> =>
    Effect.gen(function* () {
      yield* fs
        .makeDirectory(path.dirname(keyFilePath), { recursive: true, mode: 0o700 })
        .pipe(Effect.catchTags(catchPlatformError("failed to write credential key file")));
      yield* fs
        .writeFileString(keyFilePath, `${Encoding.encodeBase64(key)}\n`, { mode: privateFileMode })
        .pipe(Effect.catchTags(catchPlatformError("failed to write credential key file")));
      yield* fs
        .chmod(keyFilePath, privateFileMode)
        .pipe(
          Effect.mapError(
            mapPlatformErrorToConfigError("failed to set credential key file permissions"),
          ),
        );
    });

  return { read, write } satisfies MasterKeyKeystore;
});
