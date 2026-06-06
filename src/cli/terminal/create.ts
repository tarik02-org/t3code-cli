import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { formatTerminalCreatedHuman } from "../terminal-format.ts";
import { T3Application } from "../../application/service.ts";
import { Environment } from "../../environment/service.ts";
import { humanJsonFormatChoices, resolveOutputFormat } from "../output-format.ts";
import { T3Output } from "../output/service.ts";
import { runAttachedTerminalSession, snapshotToTerminalAttachTarget } from "./shared.ts";

export const createTerminalCommand = Command.make(
  "create",
  {
    thread: Argument.string("thread"),
    command: Argument.string("command").pipe(Argument.optional),
    id: Flag.string("id").pipe(Flag.optional),
    attach: Flag.boolean("attach"),
    format: Flag.choice("format", humanJsonFormatChoices).pipe(Flag.withDefault("auto")),
  },
  ({ thread, command, id, attach, format }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      const environment = yield* Environment;
      const output = yield* T3Output;
      const terminalId = Option.getOrUndefined(id);
      const commandValue = Option.getOrUndefined(command);
      const snapshot = yield* application.createTerminal({
        threadId: thread,
        ...(terminalId !== undefined ? { terminalId } : {}),
        ...(commandValue !== undefined ? { command: commandValue } : {}),
      });

      if (attach) {
        yield* runAttachedTerminalSession({
          application,
          terminal: snapshotToTerminalAttachTarget(snapshot),
        });
        return;
      }

      const resolvedFormat = resolveOutputFormat(format, environment, "json");
      if (resolvedFormat === "json") {
        yield* output.printJson(snapshot);
      } else {
        yield* output.printInfo(formatTerminalCreatedHuman(snapshot));
      }
    }),
).pipe(Command.withDescription("create a terminal for a thread"));
