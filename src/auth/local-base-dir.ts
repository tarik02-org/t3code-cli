import type * as Path from "effect/Path";

import { resolveT3BaseDir } from "../layout/base-dir.ts";
import type { EnvironmentShape } from "../environment/service.ts";

export function resolveLocalBaseDir(input: {
  readonly baseDir: string | undefined;
  readonly environment: EnvironmentShape;
  readonly path: Path.Path;
}) {
  return resolveT3BaseDir({
    layout: {
      cwd: input.environment.cwd,
      homeDir: input.environment.homeDir,
      t3codeHome: input.environment.env["T3CODE_HOME"],
    },
    baseDir: input.baseDir,
    path: input.path,
  });
}
