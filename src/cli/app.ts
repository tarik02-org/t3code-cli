import { Command } from "effect/unstable/cli";

import { createAuthCommand } from "./auth.ts";
import { createModelsCommand } from "./models.ts";
import { createProjectsCommand } from "./projects.ts";
import { createTerminalCommandGroup } from "./terminal.ts";
import { createThreadsCommand } from "./threads.ts";

export function createCliCommand() {
  return Command.make("t3cli").pipe(
    Command.withDescription("non-interactive cli for running t3code server"),
    Command.withSubcommands([
      createAuthCommand(),
      createModelsCommand(),
      createProjectsCommand(),
      createTerminalCommandGroup(),
      createThreadsCommand(),
    ]),
  );
}
