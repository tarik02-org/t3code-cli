import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { loadT3CliEnv } from "../env/env.ts";
import { ConfigError } from "../error.ts";

export const resolveT3cliConfigDir = Effect.fn("resolveT3cliConfigDir")(function* () {
  const path = yield* Path.Path;
  const t3CliEnv = yield* loadT3CliEnv.pipe(
    Effect.mapError(
      (error) => new ConfigError({ message: "failed to load CLI environment", cause: error }),
    ),
  );
  const home = yield* Option.match(t3CliEnv.home, {
    onNone: () => Effect.die("HOME is not set"),
    onSome: Effect.succeed,
  });
  const root = Option.match(t3CliEnv.xdgConfigHome, {
    onNone: () => path.join(home, ".config"),
    onSome: (xdgConfigHome) => xdgConfigHome,
  });
  return path.join(root, "t3cli");
});

export const resolveConfigFilePath = Effect.fn("resolveConfigFilePath")(function* () {
  const path = yield* Path.Path;
  const configDir = yield* resolveT3cliConfigDir();
  return path.join(configDir, "config.json");
});

export const resolveKeyFilePath = Effect.fn("resolveKeyFilePath")(function* () {
  const path = yield* Path.Path;
  const configDir = yield* resolveT3cliConfigDir();
  return path.join(configDir, "key");
});
