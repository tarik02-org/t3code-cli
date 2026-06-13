import { Command } from "effect/unstable/cli";

import { approveThreadCommand } from "./threads/approve.ts";
import { archiveThreadCommand } from "./threads/archive.ts";
import { callbackThreadCommand } from "./threads/callback.ts";
import { respondThreadCommand } from "./threads/respond.ts";
import { updateThreadCommand } from "./threads/update.ts";

export function createThreadCommand() {
  return Command.make("thread").pipe(
    Command.withDescription("advanced thread commands"),
    Command.withSubcommands([
      approveThreadCommand,
      respondThreadCommand,
      archiveThreadCommand,
      updateThreadCommand,
      callbackThreadCommand,
    ]),
  );
}
