import { Command } from "effect/unstable/cli";

import { attachTerminalCommand } from "./terminal/attach.ts";
import { createTerminalCommand } from "./terminal/create.ts";
import { destroyTerminalCommand } from "./terminal/destroy.ts";
import { listTerminalCommand } from "./terminal/list.ts";
import { readTerminalCommand } from "./terminal/read.ts";
import { streamTerminalCommand } from "./terminal/stream.ts";
import { waitTerminalCommand } from "./terminal/wait.ts";
import { writeTerminalCommand } from "./terminal/write.ts";

export function createTerminalCommandGroup() {
  return Command.make("terminal").pipe(
    Command.withDescription("terminal commands"),
    Command.withSubcommands([
      listTerminalCommand,
      createTerminalCommand,
      attachTerminalCommand,
      readTerminalCommand,
      streamTerminalCommand,
      waitTerminalCommand,
      writeTerminalCommand,
      destroyTerminalCommand,
    ]),
  );
}
