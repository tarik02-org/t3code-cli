import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { extraArgsConfig } from "../extra-args.ts";
import {
  asUserFlag,
  modelFlags,
  selfActionForceFlag,
  threadFlag,
  threadFormatFlag,
} from "../flags.ts";
import { readInitialMessage } from "../message-input.ts";
import { buildModelOptions } from "../model-options.ts";
import { MissingThreadError } from "../error.ts";
import { requireSelfActionConfirmation } from "../interaction/self-action.ts";
import { resolveMessageAuthor, resolveThreadId } from "../scope/index.ts";
import { T3Application } from "../../application/service.ts";
import { CliRuntime } from "../../cli/runtime/service.ts";
import { loadT3CliEnv } from "../../config/env/env.ts";
import { T3Input } from "../input/service.ts";
import { canRenderLiveTerminal, resolveOutputFormat } from "../format/output.ts";
import { T3Output } from "../output/service.ts";
import { formatThreadResultJson } from "../format/thread.ts";
import { printWaitEventsHuman, printWaitEventsNdjson } from "../wait-events.ts";

const sendModeChoices = ["auto", "queue", "steer", "restart"] as const;

export const sendThreadCommand = Command.make(
  "send",
  {
    thread: threadFlag,
    force: selfActionForceFlag,
    message: Argument.String("message").pipe(Argument.optional),
    stdin: Flag.Boolean("stdin").pipe(Flag.withDefault(false)),
    ...modelFlags,
    mode: Flag.Literals("mode", sendModeChoices).pipe(
      Flag.withDescription(
        "Delivery while a run is active: queue behind it, steer it, restart it, or let the server pick (auto)",
      ),
      Flag.withDefault("auto"),
    ),
    asUser: asUserFlag,
    wait: Flag.Boolean("wait").pipe(Flag.withDefault(false)),
    format: threadFormatFlag,
    ...extraArgsConfig,
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
    mode,
    asUser,
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
        mode,
        author: resolveMessageAuthor({ asUser, scope: t3CliEnv.scope, targetThreadId: threadId }),
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
          const projection = yield* application.waitForThread(sent.threadId);
          return yield* output.printJson({
            dispatch: sent.dispatch,
            threadId: sent.threadId,
            messageId: sent.messageId,
            ...formatThreadResultJson(projection),
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
        return yield* output.printJson({
          dispatch: result.dispatch,
          threadId: result.threadId,
          messageId: result.messageId,
          ...formatThreadResultJson(result.projection!),
        });
      }
      return yield* output.printInfo(`message sent: ${result.threadId}`);
    }),
).pipe(Command.withDescription("send message to existing thread"));
