import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { T3Application } from "../../application/service.ts";
import { InvalidLimitError } from "../error.ts";
import { threadFlag } from "../flags.ts";
import { T3Output } from "../output/service.ts";
import { requireCommandThreadId } from "./scope.ts";
import { filterAttachStreamEvent, toTerminalAttachTarget } from "./shared.ts";

const ndjsonOnlyFormatChoices = ["ndjson"] as const;

export const streamTerminalCommand = Command.make(
  "stream",
  {
    thread: threadFlag,
    terminalId: Argument.string("terminal-id"),
    fromSequence: Flag.integer("from-sequence").pipe(Flag.optional),
    format: Flag.choice("format", ndjsonOnlyFormatChoices).pipe(Flag.withDefault("ndjson")),
  },
  ({ thread, terminalId, fromSequence }) =>
    Effect.gen(function* () {
      const output = yield* T3Output;
      const application = yield* T3Application;
      const threadId = yield* requireCommandThreadId({ thread });
      const fromSequenceValue = Option.getOrUndefined(fromSequence);

      if (fromSequenceValue !== undefined && fromSequenceValue < 0) {
        yield* Effect.fail(
          new InvalidLimitError({
            message: "from-sequence must be a non-negative integer",
            value: String(fromSequenceValue),
          }),
        );
      }

      const terminal = yield* application.getTerminal({
        threadId,
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
