import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { loadT3CliEnv } from "../env/env.ts";
import { resolveConfiguredEnvironment } from "./resolve.ts";

export class T3ConfigSelection extends Context.Service<
  T3ConfigSelection,
  {
    readonly getSelectedEnvironment: () => Effect.Effect<string | undefined>;
  }
>()("t3cli/T3ConfigSelection") {}

export const layer = Layer.effect(
  T3ConfigSelection,
  Effect.gen(function* () {
    const t3CliEnv = yield* loadT3CliEnv;
    return {
      getSelectedEnvironment: () =>
        Effect.sync(() =>
          resolveConfiguredEnvironment({
            t3cliEnv: Option.getOrUndefined(t3CliEnv.t3cliEnv),
          }),
        ),
    };
  }),
);
