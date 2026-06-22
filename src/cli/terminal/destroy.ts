import * as Effect from "effect/Effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { requireDestructiveConfirmation } from "../interaction/confirm.ts";
import { formatTerminalDestroyedHuman } from "../format/terminal.ts";
import { T3Application } from "../../application/service.ts";
import { CliRuntime } from "../../cli/runtime/service.ts";
import { loadT3CliEnv } from "../../config/env/env.ts";
import { formatFlag, threadFlag, yesFlag } from "../flags.ts";
import { resolveOutputFormat } from "../format/output.ts";
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
      const cliRuntime = yield* CliRuntime;
      const t3CliEnv = yield* loadT3CliEnv;
      const output = yield* T3Output;
      const threadId = yield* requireCommandThreadId({ thread });
      yield* requireDestructiveConfirmation({
        message: `Destroy terminal ${terminalId} in thread ${threadId} and delete its history?`,
        yes,
        cliRuntime,
        t3CliEnv,
      });
      const terminal = {
        threadId,
        terminalId,
      };
      yield* application.destroyTerminal(terminal);
      if (quiet) {
        return;
      }
      const resolvedFormat = resolveOutputFormat(format, cliRuntime, t3CliEnv, "json");
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
