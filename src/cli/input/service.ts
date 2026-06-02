import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { InputError } from "./error.ts";

export class T3Input extends Context.Service<
  T3Input,
  {
    readonly readStdin: () => Effect.Effect<string, InputError>;
  }
>()("t3cli/T3Input") {}
