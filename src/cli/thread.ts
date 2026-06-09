import { Command } from "effect/unstable/cli";

import { archiveThreadCommand } from "./threads/archive.ts";
import { listThreadsCommand } from "./threads/list.ts";
import { getThreadMessagesCommand } from "./threads/messages.ts";
import { sendThreadCommand } from "./threads/send.ts";
import { startThreadCommand } from "./threads/start.ts";
import { waitForThreadCommand } from "./threads/wait.ts";

export function createThreadCommand() {
  return Command.make("thread").pipe(
    Command.withDescription("thread commands"),
    Command.withSubcommands([
      listThreadsCommand,
      startThreadCommand,
      sendThreadCommand,
      archiveThreadCommand,
      getThreadMessagesCommand,
      waitForThreadCommand,
    ]),
  );
}
