import * as Effect from "effect/Effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { Environment } from "../../environment/service.ts";
import { T3Application } from "../../application/service.ts";
import {
  canRenderLiveTerminal,
  humanNdjsonFormatChoices,
  resolveOutputFormat,
} from "../output-format.ts";
import { T3Output } from "../output/service.ts";
import { printWaitEventsHuman, printWaitEventsNdjson } from "../wait-events.ts";

export const waitForThreadCommand = Command.make(
  "wait",
  {
    thread: Argument.string("thread"),
    format: Flag.choice("format", humanNdjsonFormatChoices).pipe(Flag.withDefault("auto")),
  },
  ({ thread, format }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      const environment = yield* Environment;
      const output = yield* T3Output;
      const resolvedFormat = resolveOutputFormat(format, environment, "ndjson");
      if (resolvedFormat === "ndjson") {
        yield* printWaitEventsNdjson(output, application.watchThread(thread));
        return;
      }
      yield* printWaitEventsHuman(output, application.watchThread(thread), {
        threadId: thread,
        live: canRenderLiveTerminal(environment),
      });
    }),
).pipe(Command.withDescription("wait for thread to pause"));
