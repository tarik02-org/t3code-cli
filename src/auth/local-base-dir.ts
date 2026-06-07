import type * as Path from "effect/Path";

import type { EnvironmentShape } from "../environment/service.ts";

export function resolveLocalBaseDir(input: {
  readonly baseDir: string | undefined;
  readonly environment: EnvironmentShape;
  readonly path: Path.Path;
}) {
  const envBaseDir = input.environment.env["T3CODE_HOME"];
  const raw = input.baseDir ?? envBaseDir;
  if (raw === undefined || raw.length === 0) {
    return input.path.join(input.environment.homeDir, ".t3");
  }
  if (raw === "~") {
    return input.environment.homeDir;
  }
  if (raw.startsWith("~/") || raw.startsWith("~\\")) {
    return input.path.join(input.environment.homeDir, raw.slice(2));
  }
  return input.path.resolve(input.environment.cwd, raw);
}
