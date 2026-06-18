import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Command } from "effect/unstable/cli";

import { extraArgsConfig } from "../extra-args.ts";
import { formatFlag, selfActionForceFlag, threadFlag } from "../flags.ts";
import { MissingThreadError } from "../error.ts";
import { requireSelfActionConfirmation } from "../self-action.ts";
import { resolveThreadId } from "../../scope/index.ts";
import { T3Application } from "../../application/service.ts";
import { Environment } from "../../environment/service.ts";
import { resolveOutputFormat } from "../output-format.ts";
import { T3Output } from "../output/service.ts";

export const interruptThreadCommand = Command.make(
  "interrupt",
  {
    thread: threadFlag,
    force: selfActionForceFlag,
    format: formatFlag,
    ...extraArgsConfig,
  },
  ({ thread, force, format }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      const environment = yield* Environment;
      const output = yield* T3Output;
      const threadId = resolveThreadId({
        value: Option.getOrUndefined(thread),
        env: environment.env,
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
        environment,
        action: "interrupt",
      });
      const resolvedFormat = resolveOutputFormat(format, environment, "json");
      const dispatch = yield* application.interruptThread(threadId);
      if (resolvedFormat === "json") {
        return yield* output.printJson({ threadId, dispatch });
      }
      return yield* output.printInfo(
        `thread interrupted: ${threadId}\nsequence: ${dispatch.sequence}`,
      );
    }),
).pipe(Command.withDescription("interrupt running thread turn"));
