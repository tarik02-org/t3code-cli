import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import type * as Stream from "effect/Stream";

import type { TerminalIoError } from "./error.ts";

export type TerminalWindowSize = {
  readonly cols: number;
  readonly rows: number;
};

export type RawTerminalIoSession = {
  readonly input: Stream.Stream<Uint8Array>;
  readonly resize: Stream.Stream<TerminalWindowSize>;
};

export class TerminalIo extends Context.Service<
  TerminalIo,
  {
    readonly getWindowSize: Effect.Effect<TerminalWindowSize, TerminalIoError>;
    readonly writeOutput: (text: string) => Effect.Effect<void>;
    readonly openRawSession: Effect.Effect<RawTerminalIoSession, TerminalIoError, Scope.Scope>;
  }
>()("t3cli/cli/terminal/TerminalIo") {}
