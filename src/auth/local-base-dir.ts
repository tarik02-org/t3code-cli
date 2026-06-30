import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { CliRuntime } from "../cli/runtime/service.ts";
import type { T3CliEnvShape } from "../config/env/env.ts";
import { resolveT3BaseDir } from "../config/env/layout.ts";

export const resolveLocalBaseDir = Effect.fn("resolveLocalBaseDir")(function* (input: {
  readonly baseDir?: string | undefined;
  readonly cliRuntime: CliRuntime["Service"];
  readonly t3CliEnv: T3CliEnvShape;
}) {
  const homeDir = yield* Option.match(input.t3CliEnv.home, {
    onNone: () => Effect.die("HOME is not set"),
    onSome: Effect.succeed,
  });
  return yield* resolveT3BaseDir({
    layout: {
      cwd: input.cliRuntime.cwd,
      homeDir,
      t3codeHome: Option.getOrUndefined(input.t3CliEnv.t3codeHome),
    },
    baseDir: input.baseDir,
  });
});
