import * as Effect from "effect/Effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { formatWaitDoneHuman } from "../thread-format.ts";
import { printWaitEventsNdjson } from "../wait-events.ts";
import { T3Application } from "../../application/service.ts";
import { T3Output } from "../output/service.ts";

export const waitForThreadCommand = Command.make(
  "wait",
  {
    thread: Argument.string("thread"),
    format: Flag.choice("format", ["human", "ndjson"] as const).pipe(Flag.withDefault("human")),
  },
  ({ thread, format }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      const output = yield* T3Output;
      if (format === "ndjson") {
        yield* printWaitEventsNdjson(output, application.watchThread(thread));
        return;
      }
      yield* output.printInfo(`waiting for ${thread}...`);
      const finalThread = yield* application.waitForThread(thread);
      yield* output.writeStdout(formatWaitDoneHuman(finalThread));
    }),
).pipe(Command.withDescription("wait for thread to pause"));
