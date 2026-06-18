import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { extraArgsConfig } from "../extra-args.ts";
import { modelFlags, projectFlag, threadFormatFlag, worktreeFlag } from "../flags.ts";
import { readInitialMessage } from "../message-input.ts";
import { buildModelOptions } from "../model-options.ts";
import { requireCommandProjectRef } from "../require.ts";
import { resolveWorktreePath } from "../../scope/index.ts";
import { formatThreadStartedHuman } from "../thread-format.ts";
import { T3Application } from "../../application/service.ts";
import { Environment } from "../../environment/service.ts";
import { T3Input } from "../input/service.ts";
import { canRenderLiveTerminal, resolveOutputFormat } from "../output-format.ts";
import { T3Output } from "../output/service.ts";
import { printWaitEventsHuman, printWaitEventsNdjson } from "../wait-events.ts";

export const startThreadCommand = Command.make(
  "start",
  {
    project: projectFlag,
    message: Argument.string("message").pipe(Argument.optional),
    stdin: Flag.boolean("stdin"),
    title: Flag.string("title").pipe(Flag.optional),
    worktree: worktreeFlag,
    provider: Flag.string("provider").pipe(Flag.optional),
    model: Flag.string("model").pipe(Flag.optional),
    ...modelFlags,
    wait: Flag.boolean("wait"),
    format: threadFormatFlag,
    ...extraArgsConfig,
  },
  ({
    project,
    message,
    stdin,
    title,
    worktree,
    provider,
    model,
    option,
    reasoningEffort,
    effort,
    fastMode,
    thinking,
    wait,
    format,
  }) =>
    Effect.gen(function* () {
      const inputService = yield* T3Input;
      const text = yield* readInitialMessage({
        message: Option.getOrUndefined(message),
        fromStdin: stdin,
        readStdin: inputService.readStdin,
      });
      const titleValue = Option.getOrUndefined(title);
      const providerValue = Option.getOrUndefined(provider);
      const modelValue = Option.getOrUndefined(model);
      const options = buildModelOptions({
        option,
        reasoningEffort,
        effort,
        fastMode,
        thinking,
      });
      const application = yield* T3Application;
      const environment = yield* Environment;
      const output = yield* T3Output;
      const projectRef = yield* requireCommandProjectRef({
        project,
        env: environment.env,
        cwd: environment.cwd,
      });
      const worktreePath = resolveWorktreePath({
        value: Option.getOrUndefined(worktree),
        env: environment.env,
      });
      const input = {
        message: text,
        projectRef,
        ...(titleValue !== undefined && titleValue.length > 0 ? { title: titleValue } : {}),
        ...(worktreePath !== undefined ? { worktreePath } : {}),
        ...(providerValue !== undefined && providerValue.length > 0
          ? { provider: providerValue }
          : {}),
        ...(modelValue !== undefined && modelValue.length > 0 ? { model: modelValue } : {}),
        ...(options.length > 0 ? { options } : {}),
      };
      const resolvedFormat = resolveOutputFormat(format, environment, wait ? "ndjson" : "json");

      if (resolvedFormat === "ndjson") {
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
        if (resolvedFormat === "json") {
          const thread = yield* application.waitForThread(started.threadId);
          yield* output.printJson({
            dispatch: started.dispatch,
            threadId: started.threadId,
            thread,
          });
          return;
        }
        yield* printWaitEventsHuman(output, application.watchThread(started.threadId), {
          threadId: started.threadId,
          live: canRenderLiveTerminal(environment),
        });
        return;
      }

      const result = yield* application.startThread(input, { until: "visible" });
      if (resolvedFormat === "json") {
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
