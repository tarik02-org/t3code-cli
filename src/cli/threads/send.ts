import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { modelFlags, selfActionForceFlag, threadFlag, threadFormatFlag } from "../flags.ts";
import { readInitialMessage } from "../message-input.ts";
import { buildModelOptions } from "../model-options.ts";
import { MissingThreadError } from "../error.ts";
import { requireSelfActionConfirmation } from "../interaction/self-action.ts";
import { resolveThreadId } from "../scope/index.ts";
import { T3Application } from "../../application/service.ts";
import { CliRuntime } from "../../cli/runtime/service.ts";
import { loadT3CliEnv } from "../../config/env/env.ts";
import { T3Input } from "../input/service.ts";
import { canRenderLiveTerminal, resolveOutputFormat } from "../format/output.ts";
import { T3Output } from "../output/service.ts";
import { printWaitEventsHuman, printWaitEventsNdjson } from "../wait-events.ts";

export const sendThreadCommand = Command.make(
  "send",
  {
    thread: threadFlag,
    force: selfActionForceFlag,
    message: Argument.string("message").pipe(Argument.optional),
    stdin: Flag.boolean("stdin"),
    ...modelFlags,
    wait: Flag.boolean("wait"),
    format: threadFormatFlag,
  },
  ({
    thread,
    force,
    message,
    stdin,
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
      const threadId = resolveThreadId({
        value: Option.getOrUndefined(thread),
        scope: t3CliEnv.scope,
      });
      if (threadId === undefined) {
        return yield* Effect.fail(
          new MissingThreadError({
            message: "thread id is required: pass --thread or set T3CODE_THREAD_ID",
          }),
        );
      }
      yield* requireSelfActionConfirmation({
        threadId,
        force,
        cliRuntime,
        t3CliEnv,
        action: "send a message to",
      });
      const input = {
        message: text,
        threadId,
        ...(options.length > 0 ? { options } : {}),
      };
      const resolvedFormat = resolveOutputFormat(
        format,
        cliRuntime,
        t3CliEnv,
        wait ? "ndjson" : "json",
      );

      if (resolvedFormat === "ndjson") {
        const sent = yield* application.sendThread(input, { until: wait ? "dispatch" : "visible" });
        yield* output.printNdjson({ type: "dispatch", sequence: sent.dispatch.sequence });
        if (wait) {
          yield* printWaitEventsNdjson(output, application.watchThread(sent.threadId));
        }
        return yield* Effect.void;
      }

      if (wait) {
        const sent = yield* application.sendThread(input, { until: "dispatch" });
        if (resolvedFormat === "json") {
          const finalThread = yield* application.waitForThread(sent.threadId);
          return yield* output.printJson({
            dispatch: sent.dispatch,
            threadId: sent.threadId,
            thread: finalThread,
          });
        }
        yield* printWaitEventsHuman(output, application.watchThread(sent.threadId), {
          threadId: sent.threadId,
          live: canRenderLiveTerminal(cliRuntime, t3CliEnv),
        });
        return yield* Effect.void;
      }

      const result = yield* application.sendThread(input, { until: "visible" });
      if (resolvedFormat === "json") {
        return yield* output.printJson(result);
      }
      return yield* output.printInfo(`message sent: ${result.threadId}`);
    }),
).pipe(Command.withDescription("send message to existing thread"));
