import { Command } from "effect/unstable/cli";

import { approveThreadCommand } from "./threads/approve.ts";
import { archiveThreadCommand } from "./threads/archive.ts";
import { callbackThreadCommand } from "./threads/callback.ts";
import { listThreadsCommand } from "./threads/list.ts";
import { getThreadMessagesCommand } from "./threads/messages.ts";
import { respondThreadCommand } from "./threads/respond.ts";
import { sendThreadCommand } from "./threads/send.ts";
import { showThreadCommand } from "./threads/show.ts";
import { startThreadCommand } from "./threads/start.ts";
import { updateThreadCommand } from "./threads/update.ts";
import { waitForThreadCommand } from "./threads/wait.ts";

export function createThreadCommand() {
  return Command.make("thread").pipe(
    Command.withDescription("thread commands"),
    Command.withSubcommands([
      listThreadsCommand,
      startThreadCommand,
      sendThreadCommand,
      showThreadCommand,
      approveThreadCommand,
      respondThreadCommand,
      archiveThreadCommand,
      updateThreadCommand,
      getThreadMessagesCommand,
      waitForThreadCommand,
      callbackThreadCommand,
    ]),
  );
}
