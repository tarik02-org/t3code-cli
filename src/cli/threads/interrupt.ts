import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Command } from "effect/unstable/cli";

import { formatFlag, selfActionForceFlag, threadFlag } from "../flags.ts";
import { MissingThreadError } from "../error.ts";
import { requireSelfActionConfirmation } from "../interaction/self-action.ts";
import { resolveThreadId } from "../scope/index.ts";
import { T3Application } from "../../application/service.ts";
import { CliRuntime } from "../../cli/runtime/service.ts";
import { loadT3CliEnv } from "../../config/env/env.ts";
import { resolveOutputFormat } from "../format/output.ts";
import { T3Output } from "../output/service.ts";

export const interruptThreadCommand = Command.make(
  "interrupt",
  {
    thread: threadFlag,
    force: selfActionForceFlag,
    format: formatFlag,
  },
  ({ thread, force, format }) =>
    Effect.gen(function* () {
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
        action: "interrupt",
      });
      const resolvedFormat = resolveOutputFormat(format, cliRuntime, t3CliEnv, "json");
      const dispatch = yield* application.interruptThread(threadId);
      if (resolvedFormat === "json") {
        return yield* output.printJson({ threadId, dispatch });
      }
      return yield* output.printInfo(
        `thread interrupted: ${threadId} (sequence ${dispatch.sequence})`,
      );
    }),
).pipe(Command.withDescription("interrupt running thread turn"));
