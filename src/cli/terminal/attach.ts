import * as Effect from "effect/Effect";
import { Argument, Command } from "effect/unstable/cli";

import { T3Application } from "../../application/service.ts";
import { extraArgsConfig } from "../extra-args.ts";
import { threadFlag } from "../flags.ts";
import { requireCommandThreadId } from "./scope.ts";
import { runAttachedTerminalSession, toTerminalAttachTarget } from "./shared.ts";

export const attachTerminalCommand = Command.make(
  "attach",
  {
    thread: threadFlag,
    terminalId: Argument.string("terminal-id"),
    ...extraArgsConfig,
  },
  ({ thread, terminalId }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      const threadId = yield* requireCommandThreadId({ thread });
      const terminal = yield* application.getTerminal({
        threadId,
        terminalId,
      });
      yield* runAttachedTerminalSession({
        terminal: toTerminalAttachTarget(terminal),
      });
    }),
).pipe(Command.withDescription("attach to a terminal"));
