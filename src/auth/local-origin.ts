import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { normalizeHttpBaseUrl } from "../config/url.ts";
import { Environment } from "../environment/service.ts";
import { AuthLocalError } from "./error.ts";
import { resolveLocalBaseDir } from "./local-base-dir.ts";
import { decodeAuthLocalRuntimeStateFromJson } from "./schema.ts";
import type { LocalAuthOriginInput } from "./type.ts";

export class T3LocalAuthOrigin extends Context.Service<
  T3LocalAuthOrigin,
  {
    readonly resolve: (input?: LocalAuthOriginInput) => Effect.Effect<string, AuthLocalError>;
  }
>()("t3cli/T3LocalAuthOrigin") {}

export const makeT3LocalAuthOrigin = Effect.fn("makeT3LocalAuthOrigin")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const environment = yield* Environment;

  const resolve = Effect.fn("T3LocalAuthOriginLive.resolve")(function* (
    input?: LocalAuthOriginInput,
  ) {
    const baseDir = yield* resolveLocalBaseDir({ baseDir: input?.baseDir }).pipe(
      Effect.provideService(Environment, environment),
      Effect.provideService(Path.Path, path),
    );
    if (input?.origin !== undefined) {
      return yield* normalizeLocalOrigin(input.origin);
    }

    const runtimeStatePath = path.join(baseDir, "userdata", "server-runtime.json");
    const raw = yield* fs.readFileString(runtimeStatePath).pipe(
      Effect.mapError(
        (error) =>
          new AuthLocalError({
            message: `local runtime state not found: ${runtimeStatePath}. Make sure T3 Code is running with Network access enabled, or pass --origin manually.`,
            cause: error,
          }),
      ),
    );
    const state = yield* decodeAuthLocalRuntimeStateFromJson(raw).pipe(
      Effect.mapError(
        (error) =>
          new AuthLocalError({ message: "local runtime state has invalid shape", cause: error }),
      ),
    );
    return yield* normalizeLocalOrigin(state.origin);
  });

  return { resolve };
});

export const T3LocalAuthOriginLive = Layer.effect(T3LocalAuthOrigin, makeT3LocalAuthOrigin());

function normalizeLocalOrigin(origin: string) {
  return normalizeHttpBaseUrl(origin).pipe(
    Effect.mapError((error) => new AuthLocalError({ message: error.message, cause: error })),
  );
}
