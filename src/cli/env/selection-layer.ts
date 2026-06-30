import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { resolveConfiguredEnvironment } from "../../config/selection/resolve.ts";
import { T3ConfigSelection } from "../../config/selection/service.ts";
import { loadT3CliEnv } from "../../config/env/env.ts";
import { cliEnvironmentSetting } from "./flag.ts";

export const layer = Layer.effect(
  T3ConfigSelection,
  Effect.gen(function* () {
    const t3CliEnv = yield* loadT3CliEnv;
    return {
      getSelectedEnvironment: () =>
        Effect.gen(function* () {
          const cliEnvironment = yield* Effect.serviceOption(cliEnvironmentSetting);
          return resolveConfiguredEnvironment({
            cliFlag: Option.isSome(cliEnvironment)
              ? Option.getOrUndefined(cliEnvironment.value)
              : undefined,
            t3cliEnv: Option.getOrUndefined(t3CliEnv.t3cliEnv),
          });
        }),
    };
  }),
);
