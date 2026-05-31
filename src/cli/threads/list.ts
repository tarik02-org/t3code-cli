import * as Effect from "effect/Effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { formatThreadsHuman } from "../thread-format.ts";
import { T3Application } from "../../application/service.ts";
import { T3Output } from "../output/service.ts";

export const listThreadsCommand = Command.make(
  "list",
  {
    project: Argument.string("project"),
    format: Flag.choice("format", ["human", "json"] as const).pipe(Flag.withDefault("human")),
  },
  ({ project, format }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      const output = yield* T3Output;
      const result = yield* application.listThreads(project);
      if (format === "json") {
        yield* output.printJson(result.threads);
      } else {
        yield* output.writeStdout(formatThreadsHuman(result.threads));
      }
    }),
).pipe(Command.withDescription("list project threads"));
