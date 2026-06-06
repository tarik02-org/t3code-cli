import * as Effect from "effect/Effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { formatTerminalListHuman } from "../terminal-format.ts";
import { T3Application } from "../../application/service.ts";
import { Environment } from "../../environment/service.ts";
import { humanJsonFormatChoices, resolveOutputFormat } from "../output-format.ts";
import { T3Output } from "../output/service.ts";

export const listTerminalCommand = Command.make(
  "list",
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
      const terminals = yield* application.listTerminals(thread);
      if (resolvedFormat === "json") {
        yield* output.printJson(terminals);
      } else {
        yield* output.writeStdout(formatTerminalListHuman(terminals));
      }
    }),
).pipe(Command.withDescription("list terminals for a thread"));
