import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";

import { ConfigError } from "./error.ts";

const privateFileMode = 0o600;

export function hardenPrivateFileMode(
  fs: FileSystem.FileSystem,
  filePath: string,
  label: "config" | "credential key",
) {
  return fs.chmod(filePath, privateFileMode).pipe(
    Effect.mapError(
      (error) =>
        new ConfigError({
          message: `failed to set ${label} file permissions`,
          cause: error,
        }),
    ),
  );
}
