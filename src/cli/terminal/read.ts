import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { T3Application } from "../../application/service.ts";
import { extraArgsConfig } from "../extra-args.ts";
import { InvalidFlagCombinationError, InvalidLimitError } from "../error.ts";
import { threadFlag } from "../flags.ts";
import { T3Output } from "../output/service.ts";
import { TerminalCliError } from "./error.ts";
import { requireCommandThreadId } from "./scope.ts";
import { filterAttachStreamEvent, toTerminalAttachTarget } from "./shared.ts";

const jsonNdjsonFormatChoices = ["json", "ndjson"] as const;

export const readTerminalCommand = Command.make(
  "read",
  {
    thread: threadFlag,
    terminalId: Argument.string("terminal-id"),
    history: Flag.boolean("history"),
    follow: Flag.boolean("follow"),
    fromSequence: Flag.integer("from-sequence").pipe(Flag.optional),
    format: Flag.choice("format", jsonNdjsonFormatChoices).pipe(Flag.withDefault("json")),
    ...extraArgsConfig,
  },
  ({ thread, terminalId, history, follow, fromSequence, format }) =>
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
      if (fromSequenceValue !== undefined && !follow) {
        yield* Effect.fail(
          new InvalidFlagCombinationError({
            message: "--from-sequence requires --follow",
          }),
        );
      }
      if (follow && format !== "ndjson") {
        yield* Effect.fail(
          new InvalidFlagCombinationError({
            message: "--follow requires --format ndjson",
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
              includeHistory: history,
              ...(fromSequenceValue !== undefined ? { fromSequence: fromSequenceValue } : {}),
            }),
          ),
          Stream.filter((event): event is NonNullable<typeof event> => event !== null),
        );

      if (follow) {
        yield* Stream.runForEach(stream, (event) => output.printNdjson(event));
        return;
      }

      const item = yield* Stream.runHead(stream);
      const event = Option.getOrUndefined(item);
      if (event === undefined || event.type !== "snapshot") {
        yield* Effect.fail(
          new TerminalCliError({
            message: "server did not return terminal snapshot",
            threadId,
            terminalId,
          }),
        );
      } else {
        if (format === "ndjson") {
          yield* output.printNdjson(event);
        } else {
          yield* output.printJson(event.snapshot);
        }
      }
    }),
).pipe(Command.withDescription("read terminal state and optional history"));
