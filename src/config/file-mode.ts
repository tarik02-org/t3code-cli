import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import { mapPlatformErrorToConfigError } from "./error.ts";

const privateFileMode = 0o600;

export const hardenPrivateFileMode = Effect.fn("hardenPrivateFileMode")(function* (
  filePath: string,
  label: "config" | "credential key",
) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs
    .chmod(filePath, privateFileMode)
    .pipe(
      Effect.mapError(mapPlatformErrorToConfigError(`failed to set ${label} file permissions`)),
    );
});
