import * as Effect from "effect/Effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { T3Application } from "../../application/service.ts";
import { T3Output } from "../output/service.ts";

export const archiveThreadCommand = Command.make(
  "archive",
  {
    thread: Argument.string("thread"),
    format: Flag.choice("format", ["human", "json"] as const).pipe(Flag.withDefault("human")),
  },
  ({ thread, format }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      const output = yield* T3Output;
      const dispatch = yield* application.archiveThread(thread);
      if (format === "json") {
        yield* output.printJson(dispatch);
      } else {
        yield* output.printInfo(`thread archived: ${thread}\nsequence: ${dispatch.sequence}`);
      }
    }),
).pipe(Command.withDescription("archive thread"));
