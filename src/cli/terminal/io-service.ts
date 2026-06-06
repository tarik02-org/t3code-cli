import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { TerminalIoError } from "./error.ts";

export type TerminalWindowSize = {
  readonly cols: number;
  readonly rows: number;
};

export class TerminalIo extends Context.Service<
  TerminalIo,
  {
    readonly getWindowSize: Effect.Effect<TerminalWindowSize, TerminalIoError>;
    readonly writeOutput: (text: string) => Effect.Effect<void>;
    readonly withRawSession: <E>(handlers: {
      readonly onData: (chunk: Buffer) => Effect.Effect<void, E>;
      readonly onResize: (size: TerminalWindowSize) => Effect.Effect<void, E>;
    }) => Effect.Effect<void, E | TerminalIoError>;
  }
>()("t3cli/cli/terminal/TerminalIo") {}
