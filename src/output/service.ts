import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { OutputError } from "./error.ts";

export class T3Output extends Context.Service<
  T3Output,
  {
    readonly writeStdout: (text: string) => Effect.Effect<void, OutputError>;
    readonly writeStderr: (text: string) => Effect.Effect<void, OutputError>;
    readonly printJson: (value: unknown) => Effect.Effect<void, OutputError>;
    readonly printNdjson: (value: unknown) => Effect.Effect<void, OutputError>;
    readonly printInfo: (message: string) => Effect.Effect<void, OutputError>;
  }
>()("t3cli/T3Output") {}
