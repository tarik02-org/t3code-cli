import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { Environment } from "../environment/service.ts";
import { resolveConfiguredEnvironment } from "./selection-resolve.ts";
import { T3ConfigSelection } from "./selection.ts";

export const T3ConfigSelectionLive = Layer.effect(
  T3ConfigSelection,
  Effect.gen(function* () {
    const environment = yield* Environment;
    return {
      getSelectedEnvironment: () =>
        Effect.sync(() =>
          resolveConfiguredEnvironment({
            t3cliEnv: environment.env["T3CLI_ENV"],
          }),
        ),
    };
  }),
);
