import { Command } from "effect/unstable/cli";

import { createActionCommand } from "./action.ts";
import { createAuthCommand } from "./auth.ts";
import { createTerminalCommandGroup } from "./terminal.ts";
import { createModelCommand } from "./model.ts";
import { createProjectCommand } from "./project.ts";
import { createThreadCommand } from "./thread.ts";
import { listThreadsCommand } from "./threads/list.ts";
import { sendThreadCommand } from "./threads/send.ts";
import { showThreadCommand } from "./threads/show.ts";
import { startThreadCommand } from "./threads/start.ts";
import { getThreadTranscriptCommand } from "./threads/messages.ts";
import { waitForThreadCommand } from "./threads/wait.ts";

export function createCliCommand() {
  return Command.make("t3cli").pipe(
    Command.withDescription("non-interactive cli for running t3code server"),
    Command.withSubcommands([
      createActionCommand(),
      createAuthCommand(),
      listThreadsCommand,
      createModelCommand(),
      createProjectCommand(),
      createTerminalCommandGroup(),
      startThreadCommand,
      sendThreadCommand,
      showThreadCommand,
      getThreadTranscriptCommand,
      waitForThreadCommand,
      createThreadCommand(),
    ]),
  );
}
