import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

export const makeTempHomeScoped = Effect.fn("makeTempHomeScoped")(function* (prefix: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.makeTempDirectoryScoped({ prefix });
});
