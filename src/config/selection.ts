import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export class T3ConfigSelection extends Context.Service<
  T3ConfigSelection,
  {
    readonly getSelectedEnvironment: () => Effect.Effect<string | undefined>;
  }
>()("t3cli/T3ConfigSelection") {}
