import * as Effect from "effect/Effect";

import { Environment } from "../environment/service.ts";
import { resolveT3BaseDir } from "../layout/base-dir.ts";

export const resolveLocalBaseDir = Effect.fn("resolveLocalBaseDir")(function* (input: {
  readonly baseDir?: string | undefined;
}) {
  const environment = yield* Environment;
  return yield* resolveT3BaseDir({
    layout: {
      cwd: environment.cwd,
      homeDir: environment.homeDir,
      t3codeHome: environment.env["T3CODE_HOME"],
    },
    baseDir: input.baseDir,
  });
});
