import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { formatTerminalCreatedHuman } from "../format/terminal.ts";
import { T3Application } from "../../application/service.ts";
import { CliRuntime } from "../../cli/runtime/service.ts";
import { loadT3CliEnv } from "../../config/env/env.ts";
import { formatFlag, threadFlag } from "../flags.ts";
import { resolveOutputFormat } from "../format/output.ts";
import { T3Output } from "../output/service.ts";
import { requireCommandThreadId } from "./scope.ts";
import { runAttachedTerminalSession, snapshotToTerminalAttachTarget } from "./shared.ts";

export const createTerminalCommand = Command.make(
  "create",
  {
    thread: threadFlag,
    command: Argument.string("command").pipe(Argument.optional),
    id: Flag.string("id").pipe(Flag.optional),
    attach: Flag.boolean("attach"),
    format: formatFlag,
  },
  ({ thread, command, id, attach, format }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      const cliRuntime = yield* CliRuntime;
      const t3CliEnv = yield* loadT3CliEnv;
      const output = yield* T3Output;
      const threadId = yield* requireCommandThreadId({ thread });
      const terminalId = Option.getOrUndefined(id);
      const commandValue = Option.getOrUndefined(command);
      const snapshot = yield* application.createTerminal({
        threadId,
        ...(terminalId !== undefined ? { terminalId } : {}),
        ...(commandValue !== undefined ? { command: commandValue } : {}),
      });

      if (attach) {
        yield* runAttachedTerminalSession({
          terminal: snapshotToTerminalAttachTarget(snapshot),
        });
        return;
      }

      const resolvedFormat = resolveOutputFormat(format, cliRuntime, t3CliEnv, "json");
      if (resolvedFormat === "json") {
        yield* output.printJson(snapshot);
      } else {
        yield* output.printInfo(formatTerminalCreatedHuman(snapshot));
      }
    }),
).pipe(Command.withDescription("create a terminal for a thread"));
