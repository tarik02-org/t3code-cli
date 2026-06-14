import { Command } from "effect/unstable/cli";

import { approveThreadCommand } from "./threads/approve.ts";
import { archiveThreadCommand } from "./threads/archive.ts";
import { callbackThreadCommand } from "./threads/callback.ts";
import { deleteThreadCommand } from "./threads/delete.ts";
import { interruptThreadCommand } from "./threads/interrupt.ts";
import { respondThreadCommand } from "./threads/respond.ts";
import { unarchiveThreadCommand } from "./threads/unarchive.ts";
import { updateThreadCommand } from "./threads/update.ts";

export function createThreadCommand() {
  return Command.make("thread").pipe(
    Command.withDescription("advanced thread commands"),
    Command.withSubcommands([
      approveThreadCommand,
      respondThreadCommand,
      archiveThreadCommand,
      interruptThreadCommand,
      unarchiveThreadCommand,
      updateThreadCommand,
      deleteThreadCommand,
      callbackThreadCommand,
    ]),
  );
}
