import * as Effect from "effect/Effect";
import { Argument, Command } from "effect/unstable/cli";

import { T3Application } from "../../application/service.ts";
import { runAttachedTerminalSession, toTerminalAttachTarget } from "./shared.ts";

export const attachTerminalCommand = Command.make(
  "attach",
  {
    thread: Argument.string("thread"),
    terminalId: Argument.string("terminal-id"),
  },
  ({ thread, terminalId }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      const terminal = yield* application.getTerminal({
        threadId: thread,
        terminalId,
      });
      yield* runAttachedTerminalSession({
        application,
        terminal: toTerminalAttachTarget(terminal),
      });
    }),
).pipe(Command.withDescription("attach to a terminal"));
