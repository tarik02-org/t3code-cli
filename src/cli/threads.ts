import { Command } from "effect/unstable/cli";

import { archiveThreadCommand } from "./threads/archive.ts";
import { listThreadsCommand } from "./threads/list.ts";
import { getThreadMessagesCommand } from "./threads/messages.ts";
import { sendThreadCommand } from "./threads/send.ts";
import { startThreadCommand } from "./threads/start.ts";
import { waitForThreadCommand } from "./threads/wait.ts";

export function createThreadsCommand() {
  return Command.make("threads").pipe(
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
