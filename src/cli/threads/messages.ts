import * as Effect from "effect/Effect";
import { Command, Flag } from "effect/unstable/cli";

import { formatFlag, threadFlag } from "../flags.ts";
import { InvalidLimitError } from "../error.ts";
import { resolveThreadId } from "../scope.ts";
import { formatThreadMessagesHuman, formatThreadMessagesJson } from "../thread-format.ts";
import { T3Application } from "../../application/service.ts";
import { Environment } from "../../environment/service.ts";
import { resolveOutputFormat } from "../output-format.ts";
import { T3Output } from "../output/service.ts";

export const getThreadMessagesCommand = Command.make(
  "messages",
  {
    thread: threadFlag,
    limit: Flag.integer("limit").pipe(Flag.withDefault(20)),
    full: Flag.boolean("full"),
    format: formatFlag,
  },
  ({ thread, limit, full, format }) =>
    Effect.gen(function* () {
      if (limit < 0) {
        return yield* Effect.fail(
          new InvalidLimitError({ message: `invalid limit: ${limit}`, value: String(limit) }),
        );
      }
      const application = yield* T3Application;
      const environment = yield* Environment;
      const output = yield* T3Output;
      const threadId = yield* resolveThreadId(thread, environment.env);
      const resolvedFormat = resolveOutputFormat(format, environment, "json");
      const detail = yield* application.getThreadMessages(threadId);
      if (resolvedFormat === "json") {
        return yield* output.printJson(formatThreadMessagesJson(detail, full));
      }
      return yield* output.writeStdout(formatThreadMessagesHuman(detail, limit));
    }),
).pipe(Command.withDescription("get latest thread messages"));
