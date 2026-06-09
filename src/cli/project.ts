import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Command, Flag } from "effect/unstable/cli";

import { formatFlag, projectPathFlag } from "./flags.ts";
import { formatProjectAddedHuman, formatProjectsHuman } from "./project-format.ts";
import { T3Application } from "../application/service.ts";
import { Environment } from "../environment/service.ts";
import { resolveOutputFormat } from "./output-format.ts";
import { T3Output } from "./output/service.ts";

export function createProjectCommand() {
  return Command.make("project").pipe(
    Command.withDescription("project commands"),
    Command.withSubcommands([listCommand, addCommand]),
  );
}

const listCommand = Command.make(
  "list",
  {
    format: formatFlag,
  },
  ({ format }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      const environment = yield* Environment;
      const output = yield* T3Output;
      const resolvedFormat = resolveOutputFormat(format, environment, "json");
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
  },
  ({ path, title, format }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      const environment = yield* Environment;
      const output = yield* T3Output;
      const resolvedFormat = resolveOutputFormat(format, environment, "json");
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
