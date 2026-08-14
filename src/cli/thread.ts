import { Command } from "effect/unstable/cli";

import { approveThreadCommand } from "./threads/approve.ts";
import { archiveThreadCommand } from "./threads/archive.ts";
import { callbackThreadCommand } from "./threads/callback.ts";
import { deleteThreadCommand } from "./threads/delete.ts";
import { interruptThreadCommand } from "./threads/interrupt.ts";
import { pinThreadCommand } from "./threads/pin.ts";
import { respondThreadCommand } from "./threads/respond.ts";
import { settleThreadCommand } from "./threads/settle.ts";
import { snoozeThreadCommand } from "./threads/snooze.ts";
import { unarchiveThreadCommand } from "./threads/unarchive.ts";
import { unpinThreadCommand } from "./threads/unpin.ts";
import { unsnoozeThreadCommand } from "./threads/unsnooze.ts";
import { unsettleThreadCommand } from "./threads/unsettle.ts";
import { updateThreadCommand } from "./threads/update.ts";

export function createThreadCommand() {
  return Command.make("thread").pipe(
    Command.withDescription("advanced thread commands"),
    Command.withSubcommands([
      approveThreadCommand,
      respondThreadCommand,
      archiveThreadCommand,
      interruptThreadCommand,
      settleThreadCommand,
      unsettleThreadCommand,
      snoozeThreadCommand,
      unsnoozeThreadCommand,
      pinThreadCommand,
      unpinThreadCommand,
      unarchiveThreadCommand,
      updateThreadCommand,
      deleteThreadCommand,
      callbackThreadCommand,
    ]),
  );
}
