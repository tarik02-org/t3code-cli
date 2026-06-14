import * as Effect from "effect/Effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { requireDestructiveConfirmation } from "../confirm.ts";
import { formatTerminalDestroyedHuman } from "../terminal-format.ts";
import { T3Application } from "../../application/service.ts";
import { Environment } from "../../environment/service.ts";
import { formatFlag, threadFlag, yesFlag } from "../flags.ts";
import { resolveOutputFormat } from "../output-format.ts";
import { T3Output } from "../output/service.ts";
import { requireCommandThreadId } from "./scope.ts";

export const destroyTerminalCommand = Command.make(
  "destroy",
  {
    thread: threadFlag,
    terminalId: Argument.string("terminal-id"),
    quiet: Flag.boolean("quiet"),
    yes: yesFlag,
    format: formatFlag,
  },
  ({ thread, terminalId, quiet, yes, format }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      const environment = yield* Environment;
      const output = yield* T3Output;
      const threadId = yield* requireCommandThreadId({
        thread,
        env: environment.env,
      });
      yield* requireDestructiveConfirmation({
        message: `Destroy terminal ${terminalId} in thread ${threadId} and delete its history?`,
        yes,
        environment,
      });
      const terminal = {
        threadId,
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
          threadId,
        }),
      );
    }),
).pipe(Command.withDescription("destroy a terminal and its history"));
