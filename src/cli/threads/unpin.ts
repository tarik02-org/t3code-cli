import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Command } from "effect/unstable/cli";

import { T3Application } from "../../application/service.ts";
import { loadT3CliEnv } from "../../config/env/env.ts";
import { MissingThreadError } from "../error.ts";
import { extraArgsConfig } from "../extra-args.ts";
import { formatFlag, threadFlag } from "../flags.ts";
import { resolveOutputFormat } from "../format/output.ts";
import { T3Output } from "../output/service.ts";
import { CliRuntime } from "../runtime/service.ts";
import { resolveThreadId } from "../scope/index.ts";

export const unpinThreadCommand = Command.make(
  "unpin",
  {
    thread: threadFlag,
    format: formatFlag,
    ...extraArgsConfig,
  },
  ({ thread, format }) =>
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
      const resolvedFormat = resolveOutputFormat(format, cliRuntime, t3CliEnv, "json");
      const dispatch = yield* application.unpinThread(threadId);
      if (resolvedFormat === "json") {
        return yield* output.printJson(dispatch);
      }
      return yield* output.printInfo(
        `thread unpinned: ${threadId} (sequence ${dispatch.sequence})`,
      );
    }),
).pipe(Command.withDescription("unpin thread"));
