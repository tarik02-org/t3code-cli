import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { extraArgsConfig } from "../extra-args.ts";
import { modelFlags, projectFlag, threadFormatFlag, worktreeFlag } from "../flags.ts";
import { readInitialMessage } from "../message-input.ts";
import { buildModelOptions } from "../model-options.ts";
import { requireCommandProjectRef } from "../require.ts";
import { resolveWorktreePath } from "../scope/index.ts";
import { formatThreadResultJson, formatThreadStartedHuman } from "../format/thread.ts";
import { T3Application } from "../../application/service.ts";
import { CliRuntime } from "../../cli/runtime/service.ts";
import { loadT3CliEnv } from "../../config/env/env.ts";
import { T3Input } from "../input/service.ts";
import { canRenderLiveTerminal, resolveOutputFormat } from "../format/output.ts";
import { T3Output } from "../output/service.ts";
import { printWaitEventsHuman, printWaitEventsNdjson } from "../wait-events.ts";

export const startThreadCommand = Command.make(
  "start",
  {
    project: projectFlag,
    message: Argument.String("message").pipe(Argument.optional),
    stdin: Flag.Boolean("stdin").pipe(Flag.withDefault(false)),
    title: Flag.String("title").pipe(Flag.optional),
    worktree: worktreeFlag,
    provider: Flag.String("provider").pipe(Flag.optional),
    model: Flag.String("model").pipe(Flag.optional),
    ...modelFlags,
    wait: Flag.Boolean("wait").pipe(Flag.withDefault(false)),
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
      const cliRuntime = yield* CliRuntime;
      const t3CliEnv = yield* loadT3CliEnv;
      const output = yield* T3Output;
      const projectRef = yield* requireCommandProjectRef({ project });
      const worktreePath = resolveWorktreePath({
        value: Option.getOrUndefined(worktree),
        scope: t3CliEnv.scope,
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
      const resolvedFormat = resolveOutputFormat(
        format,
        cliRuntime,
        t3CliEnv,
        wait ? "ndjson" : "json",
      );

      if (resolvedFormat === "ndjson") {
        const started = yield* application.startThread(input, { until: "visible" });
        yield* output.printNdjson({ type: "started", threadId: started.threadId });
        yield* printWaitEventsNdjson(
          output,
          wait
            ? application.watchThread(started.threadId)
            : Stream.make({ type: "thread", projection: started.projection! }),
        );
        return;
      }

      if (wait) {
        const started = yield* application.startThread(input, { until: "dispatch" });
        if (resolvedFormat === "json") {
          const projection = yield* application.waitForThread(started.threadId);
          yield* output.printJson({
            threadId: started.threadId,
            ...formatThreadResultJson(projection),
          });
          return;
        }
        yield* printWaitEventsHuman(output, application.watchThread(started.threadId), {
          threadId: started.threadId,
          live: canRenderLiveTerminal(cliRuntime, t3CliEnv),
        });
        return;
      }

      const result = yield* application.startThread(input, { until: "visible" });
      if (resolvedFormat === "json") {
        yield* output.printJson({
          threadId: result.threadId,
          project: result.project,
          ...formatThreadResultJson(result.projection!),
        });
      } else {
        yield* output.printInfo(formatThreadStartedHuman(result.projection!));
      }
    }),
).pipe(Command.withDescription("start thread with initial message"));
