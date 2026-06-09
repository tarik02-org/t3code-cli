import * as Effect from "effect/Effect";
import { Command } from "effect/unstable/cli";

import { threadFlag, waitFormatFlag } from "../flags.ts";
import { resolveThreadId } from "../scope.ts";
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
  },
  ({ thread, format }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      const environment = yield* Environment;
      const output = yield* T3Output;
      const threadId = yield* resolveThreadId(thread, environment.env);
      const resolvedFormat = resolveOutputFormat(format, environment, "ndjson");
      if (resolvedFormat === "ndjson") {
        yield* printWaitEventsNdjson(output, application.watchThread(threadId));
        return;
      }
      yield* printWaitEventsHuman(output, application.watchThread(threadId), {
        threadId,
        live: canRenderLiveTerminal(environment),
      });
    }),
).pipe(Command.withDescription("wait for thread to pause"));
