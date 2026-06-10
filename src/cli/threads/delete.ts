import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Command } from "effect/unstable/cli";

import { requireDestructiveConfirmation } from "../confirm.ts";
import { formatFlag, threadFlag, yesFlag } from "../flags.ts";
import { MissingThreadError } from "../error.ts";
import { resolveThreadId } from "../../scope/index.ts";
import { T3Application } from "../../application/service.ts";
import { Environment } from "../../environment/service.ts";
import { resolveOutputFormat } from "../output-format.ts";
import { T3Output } from "../output/service.ts";

export const deleteThreadCommand = Command.make(
  "delete",
  {
    thread: threadFlag,
    yes: yesFlag,
    format: formatFlag,
  },
  ({ thread, yes, format }) =>
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
      const threadSnapshot = yield* application.getThreadMessages(threadId).pipe(Effect.option);
      const title = Option.match(threadSnapshot, {
        onNone: () => threadId,
        onSome: (snapshot) => snapshot.title,
      });
      yield* requireDestructiveConfirmation({
        message: `Delete thread ${title} (${threadId})?`,
        yes,
        environment,
      });
      const resolvedFormat = resolveOutputFormat(format, environment, "json");
      const result = yield* application.deleteThread(threadId);
      if (resolvedFormat === "json") {
        return yield* output.printJson({
          threadId: result.threadId,
          dispatch: result.dispatch,
        });
      }
      return yield* output.printInfo(
        `thread deleted: ${result.threadId}\nsequence: ${result.dispatch.sequence}`,
      );
    }),
).pipe(Command.withDescription("delete thread"));
