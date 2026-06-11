import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Command, Flag } from "effect/unstable/cli";

import { formatFlag, threadFlag } from "../flags.ts";
import { MissingThreadError, SelfArchiveError } from "../error.ts";
import { resolveThreadId } from "../../scope/index.ts";
import { T3Application } from "../../application/service.ts";
import { Environment } from "../../environment/service.ts";
import { resolveOutputFormat } from "../output-format.ts";
import { T3Output } from "../output/service.ts";

export const archiveThreadCommand = Command.make(
  "archive",
  {
    thread: threadFlag,
    force: Flag.boolean("force").pipe(Flag.withAlias("f")),
    format: formatFlag,
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
      const envThreadId = environment.env.T3CODE_THREAD_ID;
      if (
        envThreadId !== undefined &&
        envThreadId.length > 0 &&
        threadId === envThreadId &&
        !force
      ) {
        return yield* Effect.fail(
          new SelfArchiveError({
            threadId,
            message: `cannot archive thread ${threadId}: matches T3CODE_THREAD_ID (are you trying to archive yourself?). Use --force to override.`,
          }),
        );
      }
      const resolvedFormat = resolveOutputFormat(format, environment, "json");
      const dispatch = yield* application.archiveThread(threadId);
      if (resolvedFormat === "json") {
        return yield* output.printJson(dispatch);
      }
      return yield* output.printInfo(
        `thread archived: ${threadId}\nsequence: ${dispatch.sequence}`,
      );
    }),
).pipe(Command.withDescription("archive thread"));
