import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { readInitialMessage } from "../message-input.ts";
import { formatThreadStartedHuman, formatWaitDoneHuman } from "../thread-format.ts";
import { printWaitEventsNdjson } from "../wait-events.ts";
import { T3Application } from "../../application/service.ts";
import { T3Input } from "../input/service.ts";
import { T3Output } from "../output/service.ts";

export const startThreadCommand = Command.make(
  "start",
  {
    project: Argument.string("project"),
    message: Argument.string("message").pipe(Argument.optional),
    stdin: Flag.boolean("stdin"),
    title: Flag.string("title").pipe(Flag.optional),
    worktree: Flag.string("worktree").pipe(Flag.optional),
    provider: Flag.string("provider").pipe(Flag.optional),
    model: Flag.string("model").pipe(Flag.optional),
    wait: Flag.boolean("wait"),
    format: Flag.choice("format", ["human", "json", "ndjson"] as const).pipe(
      Flag.withDefault("human"),
    ),
  },
  ({ project, message, stdin, title, worktree, provider, model, wait, format }) =>
    Effect.gen(function* () {
      const inputService = yield* T3Input;
      const text = yield* readInitialMessage({
        message: Option.getOrUndefined(message),
        fromStdin: stdin,
        readStdin: inputService.readStdin,
      });
      const titleValue = Option.getOrUndefined(title);
      const worktreeValue = Option.getOrUndefined(worktree);
      const providerValue = Option.getOrUndefined(provider);
      const modelValue = Option.getOrUndefined(model);
      const input = {
        projectRef: project,
        message: text,
        ...(titleValue !== undefined && titleValue.length > 0 ? { title: titleValue } : {}),
        ...(worktreeValue !== undefined && worktreeValue.length > 0
          ? { worktreePath: worktreeValue }
          : {}),
        ...(providerValue !== undefined && providerValue.length > 0
          ? { provider: providerValue }
          : {}),
        ...(modelValue !== undefined && modelValue.length > 0 ? { model: modelValue } : {}),
      };
      const application = yield* T3Application;
      const output = yield* T3Output;

      if (format === "ndjson") {
        const started = yield* application.startThread(input, {
          until: wait ? "dispatch" : "visible",
        });
        yield* output.printNdjson({ type: "dispatch", sequence: started.dispatch.sequence });
        if (wait) {
          yield* printWaitEventsNdjson(output, application.watchThread(started.threadId));
        } else {
          yield* printWaitEventsNdjson(
            output,
            Stream.fromIterable([{ type: "thread", thread: started.thread! }]),
          );
        }
        return;
      }

      if (wait) {
        const started = yield* application.startThread(input, { until: "dispatch" });
        yield* output.printInfo(`waiting for ${started.threadId}...`);
        const thread = yield* application.waitForThread(started.threadId);
        yield* output.writeStdout(formatWaitDoneHuman(thread));
        return;
      }

      const result = yield* application.startThread(input, { until: "visible" });
      if (format === "json") {
        yield* output.printJson(result);
      } else {
        yield* output.printInfo(
          formatThreadStartedHuman({
            thread: result.thread!,
            sequence: result.dispatch.sequence,
          }),
        );
      }
    }),
).pipe(Command.withDescription("start thread with initial message"));
