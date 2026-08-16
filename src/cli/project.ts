import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Command, Flag } from "effect/unstable/cli";

import { extraArgsConfig } from "./extra-args.ts";
import { formatFlag, projectPathFlag } from "./flags.ts";
import { formatProjectAddedHuman, formatProjectsHuman } from "./format/project.ts";
import { deleteProjectCommand } from "./projects/delete.ts";
import { updateProjectCommand } from "./projects/update.ts";
import { T3Application } from "../application/service.ts";
import { CliRuntime } from "../cli/runtime/service.ts";
import { loadT3CliEnv } from "../config/env/env.ts";
import { resolveOutputFormat } from "./format/output.ts";
import { T3Output } from "./output/service.ts";

export function createProjectCommand() {
  return Command.make("project").pipe(
    Command.withDescription("project commands"),
    Command.withSubcommands([listCommand, addCommand, updateProjectCommand, deleteProjectCommand]),
  );
}

const listCommand = Command.make(
  "list",
  {
    format: formatFlag,
    ...extraArgsConfig,
  },
  ({ format }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      const cliRuntime = yield* CliRuntime;
      const t3CliEnv = yield* loadT3CliEnv;
      const output = yield* T3Output;
      const resolvedFormat = resolveOutputFormat(format, cliRuntime, t3CliEnv, "json");
      const snapshot = yield* application.loadShell();
      if (resolvedFormat === "json") {
        yield* output.printJson(snapshot.projects);
      } else {
        yield* output.writeStdout(formatProjectsHuman(snapshot.projects));
      }
    }),
).pipe(Command.withDescription("list projects"));

const addCommand = Command.make(
  "add",
  {
    path: projectPathFlag,
    title: Flag.string("title").pipe(Flag.optional),
    format: formatFlag,
    ...extraArgsConfig,
  },
  ({ path, title, format }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      const cliRuntime = yield* CliRuntime;
      const t3CliEnv = yield* loadT3CliEnv;
      const output = yield* T3Output;
      const resolvedFormat = resolveOutputFormat(format, cliRuntime, t3CliEnv, "json");
      const titleValue = Option.getOrUndefined(title);
      const result = yield* application.addProject({
        path,
        ...(titleValue !== undefined && titleValue.length > 0 ? { title: titleValue } : {}),
      });
      if (resolvedFormat === "json") {
        yield* output.printJson(result);
      } else {
        yield* output.printInfo(formatProjectAddedHuman(result.project));
      }
    }),
).pipe(Command.withDescription("add project"));
