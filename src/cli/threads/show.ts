import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Command } from "effect/unstable/cli";

import { formatFlag, threadFlag } from "../flags.ts";
import { MissingThreadError } from "../error.ts";
import { resolveThreadId } from "../scope/index.ts";
import { formatThreadShowHuman, formatThreadShowJson } from "../format/thread.ts";
import { T3Application } from "../../application/service.ts";
import { CliRuntime } from "../../cli/runtime/service.ts";
import { loadT3CliEnv } from "../../config/env/env.ts";
import { resolveOutputFormat } from "../format/output.ts";
import { T3Output } from "../output/service.ts";

export const showThreadCommand = Command.make(
  "show",
  {
    thread: threadFlag,
    format: formatFlag,
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
      const detail = yield* application.showThread(threadId);
      if (resolvedFormat === "json") {
        return yield* output.printJson(formatThreadShowJson(detail));
      }
      return yield* output.writeStdout(formatThreadShowHuman(detail));
    }),
).pipe(Command.withDescription("show thread status and pending requests"));
