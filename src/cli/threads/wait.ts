import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Command } from "effect/unstable/cli";

import { extraArgsConfig } from "../extra-args.ts";
import { threadFlag, waitFormatFlag } from "../flags.ts";
import { MissingThreadError } from "../error.ts";
import { resolveThreadId } from "../../scope/index.ts";
import { Environment } from "../../environment/service.ts";
import { T3Application } from "../../application/service.ts";
import { canRenderLiveTerminal, resolveOutputFormat } from "../output-format.ts";
import { T3Output } from "../output/service.ts";
import { printWaitEventsHuman, printWaitEventsNdjson } from "../wait-events.ts";

export const waitForThreadCommand = Command.make(
  "wait",
  {
    thread: threadFlag,
    format: waitFormatFlag,
    ...extraArgsConfig,
  },
  ({ thread, format }) =>
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
      const resolvedFormat = resolveOutputFormat(format, environment, "ndjson");
      if (resolvedFormat === "ndjson") {
        return yield* printWaitEventsNdjson(output, application.watchThread(threadId));
      }
      return yield* printWaitEventsHuman(output, application.watchThread(threadId), {
        threadId,
        live: canRenderLiveTerminal(environment),
      });
    }),
).pipe(Command.withDescription("wait for thread to pause"));
