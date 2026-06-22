import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { resolveConfiguredEnvironment } from "../config/selection-resolve.ts";
import { T3ConfigSelection } from "../config/selection.ts";
import { Environment } from "../environment/service.ts";
import { cliEnvironmentSetting } from "./environment-flag.ts";

export const T3CliConfigSelectionLive = Layer.effect(
  T3ConfigSelection,
  Effect.gen(function* () {
    const environment = yield* Environment;
    return {
      getSelectedEnvironment: () =>
        Effect.gen(function* () {
          const cliEnvironment = yield* Effect.serviceOption(cliEnvironmentSetting);
          return resolveConfiguredEnvironment({
            cliFlag: Option.isSome(cliEnvironment)
              ? Option.getOrUndefined(cliEnvironment.value)
              : undefined,
            t3cliEnv: environment.env["T3CLI_ENV"],
          });
        }),
    };
  }),
);
