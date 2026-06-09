import { Command } from "effect/unstable/cli";

import { createAuthCommand } from "./auth.ts";
import { createModelCommand } from "./model.ts";
import { createProjectCommand } from "./project.ts";
import { createThreadCommand } from "./thread.ts";

export function createCliCommand() {
  return Command.make("t3cli").pipe(
    Command.withDescription("non-interactive cli for running t3code server"),
    Command.withSubcommands([
      createAuthCommand(),
      createModelCommand(),
      createProjectCommand(),
      createThreadCommand(),
    ]),
  );
}
