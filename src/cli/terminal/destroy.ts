import * as Effect from "effect/Effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { formatTerminalDestroyedHuman } from "../terminal-format.ts";
import { T3Application } from "../../application/service.ts";
import { Environment } from "../../environment/service.ts";
import { humanJsonFormatChoices, resolveOutputFormat } from "../output-format.ts";
import { T3Output } from "../output/service.ts";

export const destroyTerminalCommand = Command.make(
  "destroy",
  {
    thread: Argument.string("thread"),
    terminalId: Argument.string("terminal-id"),
    quiet: Flag.boolean("quiet"),
    format: Flag.choice("format", humanJsonFormatChoices).pipe(Flag.withDefault("auto")),
  },
  ({ thread, terminalId, quiet, format }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      const environment = yield* Environment;
      const output = yield* T3Output;
      const terminal = {
        threadId: thread,
        terminalId,
      };
      yield* application.destroyTerminal(terminal);
      if (quiet) {
        return;
      }
      const resolvedFormat = resolveOutputFormat(format, environment, "json");
      if (resolvedFormat === "json") {
        yield* output.printJson({
          threadId: terminal.threadId,
          terminalId: terminal.terminalId,
          destroyed: true,
        });
        return;
      }
      yield* output.printInfo(
        formatTerminalDestroyedHuman({
          terminalId,
          threadId: thread,
        }),
      );
    }),
).pipe(Command.withDescription("destroy a terminal and its history"));
