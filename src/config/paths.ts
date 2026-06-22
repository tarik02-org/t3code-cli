import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { Environment } from "../environment/service.ts";

export const resolveT3cliConfigDir = Effect.fn("resolveT3cliConfigDir")(function* () {
  const path = yield* Path.Path;
  const environment = yield* Environment;
  const xdgConfigHome = environment.env["XDG_CONFIG_HOME"]?.trim();
  const root =
    xdgConfigHome !== undefined && xdgConfigHome.length > 0
      ? xdgConfigHome
      : path.join(environment.homeDir, ".config");
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
