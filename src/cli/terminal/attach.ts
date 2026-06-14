import * as Effect from "effect/Effect";
import { Argument, Command } from "effect/unstable/cli";

import { T3Application } from "../../application/service.ts";
import { Environment } from "../../environment/service.ts";
import { threadFlag } from "../flags.ts";
import { requireCommandThreadId } from "./scope.ts";
import { runAttachedTerminalSession, toTerminalAttachTarget } from "./shared.ts";

export const attachTerminalCommand = Command.make(
  "attach",
  {
    thread: threadFlag,
    terminalId: Argument.string("terminal-id"),
  },
  ({ thread, terminalId }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      const environment = yield* Environment;
      const threadId = yield* requireCommandThreadId({
        thread,
        env: environment.env,
      });
      const terminal = yield* application.getTerminal({
        threadId,
        terminalId,
      });
      yield* runAttachedTerminalSession({
        terminal: toTerminalAttachTarget(terminal),
      });
    }),
).pipe(Command.withDescription("attach to a terminal"));
