import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { T3Application } from "../../application/service.ts";
import { T3Output } from "../output/service.ts";
import { TerminalCliError } from "./error.ts";
import { filterAttachStreamEvent, toTerminalAttachTarget } from "./shared.ts";

const ndjsonOnlyFormatChoices = ["ndjson"] as const;

export const streamTerminalCommand = Command.make(
  "stream",
  {
    thread: Argument.string("thread"),
    terminalId: Argument.string("terminal-id"),
    fromSequence: Flag.integer("from-sequence").pipe(Flag.optional),
    format: Flag.choice("format", ndjsonOnlyFormatChoices).pipe(Flag.withDefault("ndjson")),
  },
  ({ thread, terminalId, fromSequence }) =>
    Effect.gen(function* () {
      const output = yield* T3Output;
      const application = yield* T3Application;
      const fromSequenceValue = Option.getOrUndefined(fromSequence);

      if (fromSequenceValue !== undefined && fromSequenceValue < 0) {
        yield* Effect.fail(
          new TerminalCliError({
            message: `invalid from-sequence: ${fromSequenceValue}`,
            threadId: thread,
            terminalId,
          }),
        );
      }

      const terminal = yield* application.getTerminal({
        threadId: thread,
        terminalId,
      });
      const stream = application
        .attachTerminal({
          terminal: toTerminalAttachTarget(terminal),
        })
        .pipe(
          Stream.map((event) =>
            filterAttachStreamEvent(event, {
              includeHistory: true,
              ...(fromSequenceValue !== undefined ? { fromSequence: fromSequenceValue } : {}),
            }),
          ),
          Stream.filter((event): event is NonNullable<typeof event> => event !== null),
        );

      yield* Stream.runForEach(stream, (event) => output.printNdjson(event));
    }),
).pipe(Command.withDescription("stream terminal attach events as ndjson"));
