import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { readInitialMessage } from "../message-input.ts";
import { T3Application } from "../../application/service.ts";
import { Environment } from "../../environment/service.ts";
import { T3Input } from "../input/service.ts";
import {
  canRenderLiveTerminal,
  humanJsonNdjsonFormatChoices,
  resolveOutputFormat,
} from "../output-format.ts";
import { T3Output } from "../output/service.ts";
import { printWaitEventsHuman, printWaitEventsNdjson } from "../wait-events.ts";

export const sendThreadCommand = Command.make(
  "send",
  {
    thread: Argument.string("thread"),
    message: Argument.string("message").pipe(Argument.optional),
    stdin: Flag.boolean("stdin"),
    wait: Flag.boolean("wait"),
    format: Flag.choice("format", humanJsonNdjsonFormatChoices).pipe(Flag.withDefault("auto")),
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
      const environment = yield* Environment;
      const output = yield* T3Output;
      const resolvedFormat = resolveOutputFormat(format, environment, wait ? "ndjson" : "json");

      if (resolvedFormat === "ndjson") {
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
        if (resolvedFormat === "json") {
          const finalThread = yield* application.waitForThread(sent.threadId);
          yield* output.printJson({
            dispatch: sent.dispatch,
            threadId: sent.threadId,
            thread: finalThread,
          });
          return;
        }
        yield* printWaitEventsHuman(output, application.watchThread(sent.threadId), {
          threadId: sent.threadId,
          live: canRenderLiveTerminal(environment),
        });
        return;
      }

      const result = yield* application.sendThread(
        { message: text, threadId: thread },
        { until: "visible" },
      );
      if (resolvedFormat === "json") {
        yield* output.printJson(result);
      } else {
        yield* output.printInfo(`message sent: ${result.threadId}`);
      }
    }),
).pipe(Command.withDescription("send message to existing thread"));
