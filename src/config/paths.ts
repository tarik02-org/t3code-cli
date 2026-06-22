import type * as Path from "effect/Path";

import type { EnvironmentShape } from "../environment/service.ts";

export function resolveT3cliConfigDir(path: Path.Path, environment: EnvironmentShape) {
  const xdgConfigHome = environment.env["XDG_CONFIG_HOME"]?.trim();
  const root =
    xdgConfigHome !== undefined && xdgConfigHome.length > 0
      ? xdgConfigHome
      : path.join(environment.homeDir, ".config");
  return path.join(root, "t3cli");
}

export function resolveConfigFilePath(path: Path.Path, environment: EnvironmentShape) {
  return path.join(resolveT3cliConfigDir(path, environment), "config.json");
}

export function resolveKeyFilePath(path: Path.Path, environment: EnvironmentShape) {
  return path.join(resolveT3cliConfigDir(path, environment), "key");
}
