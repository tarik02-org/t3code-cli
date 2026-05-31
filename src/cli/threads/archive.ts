import * as Effect from "effect/Effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { T3Application } from "../../application/service.ts";
import { Environment } from "../../environment/service.ts";
import { humanJsonFormatChoices, resolveOutputFormat } from "../output-format.ts";
import { T3Output } from "../output/service.ts";

export const archiveThreadCommand = Command.make(
  "archive",
  {
    thread: Argument.string("thread"),
    format: Flag.choice("format", humanJsonFormatChoices).pipe(Flag.withDefault("auto")),
  },
  ({ thread, format }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      const environment = yield* Environment;
      const output = yield* T3Output;
      const resolvedFormat = resolveOutputFormat(format, environment, "json");
      const dispatch = yield* application.archiveThread(thread);
      if (resolvedFormat === "json") {
        yield* output.printJson(dispatch);
      } else {
        yield* output.printInfo(`thread archived: ${thread}\nsequence: ${dispatch.sequence}`);
      }
    }),
).pipe(Command.withDescription("archive thread"));
