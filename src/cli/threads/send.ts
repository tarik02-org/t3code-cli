import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { readInitialMessage } from "../message-input.ts";
import { formatWaitDoneHuman } from "../thread-format.ts";
import { printWaitEventsNdjson } from "../wait-events.ts";
import { T3Application } from "../../application/service.ts";
import { T3Input } from "../input/service.ts";
import { T3Output } from "../output/service.ts";

export const sendThreadCommand = Command.make(
  "send",
  {
    thread: Argument.string("thread"),
    message: Argument.string("message").pipe(Argument.optional),
    stdin: Flag.boolean("stdin"),
    wait: Flag.boolean("wait"),
    format: Flag.choice("format", ["human", "json", "ndjson"] as const).pipe(
      Flag.withDefault("human"),
    ),
  },
  ({ thread, message, stdin, wait, format }) =>
    Effect.gen(function* () {
      const inputService = yield* T3Input;
      const text = yield* readInitialMessage({
        message: Option.getOrUndefined(message),
        fromStdin: stdin,
        readStdin: inputService.readStdin,
      });
      const application = yield* T3Application;
      const output = yield* T3Output;

      if (format === "ndjson") {
        const sent = yield* application.sendThread(
          { message: text, threadId: thread },
          { until: wait ? "dispatch" : "visible" },
        );
        yield* output.printNdjson({ type: "dispatch", sequence: sent.dispatch.sequence });
        if (wait) {
          yield* printWaitEventsNdjson(output, application.watchThread(sent.threadId));
        }
        return;
      }

      if (wait) {
        const sent = yield* application.sendThread(
          { message: text, threadId: thread },
          { until: "dispatch" },
        );
        yield* output.printInfo(`waiting for ${sent.threadId}...`);
        const finalThread = yield* application.waitForThread(sent.threadId);
        yield* output.writeStdout(formatWaitDoneHuman(finalThread));
        return;
      }

      const result = yield* application.sendThread(
        { message: text, threadId: thread },
        { until: "visible" },
      );
      if (format === "json") {
        yield* output.printJson(result);
      } else {
        yield* output.printInfo(`message sent: ${result.threadId}`);
      }
    }),
).pipe(Command.withDescription("send message to existing thread"));
