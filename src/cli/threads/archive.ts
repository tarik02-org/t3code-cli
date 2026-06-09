import * as Effect from "effect/Effect";
import { Command } from "effect/unstable/cli";

import { formatFlag, threadFlag } from "../flags.ts";
import { resolveThreadId } from "../scope.ts";
import { T3Application } from "../../application/service.ts";
import { Environment } from "../../environment/service.ts";
import { resolveOutputFormat } from "../output-format.ts";
import { T3Output } from "../output/service.ts";

export const archiveThreadCommand = Command.make(
  "archive",
  {
    thread: threadFlag,
    format: formatFlag,
  },
  ({ thread, format }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      const environment = yield* Environment;
      const output = yield* T3Output;
      const threadId = yield* resolveThreadId(thread, environment.env);
      const resolvedFormat = resolveOutputFormat(format, environment, "json");
      const dispatch = yield* application.archiveThread(threadId);
      if (resolvedFormat === "json") {
        yield* output.printJson(dispatch);
      } else {
        yield* output.printInfo(`thread archived: ${threadId}\nsequence: ${dispatch.sequence}`);
      }
    }),
).pipe(Command.withDescription("archive thread"));
