import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { formatProjectAddedHuman, formatProjectsHuman } from "../domain/project-format.ts";
import { T3Domain } from "../domain/service.ts";
import { T3Output } from "../output/service.ts";

export function createProjectsCommand() {
  return Command.make("projects").pipe(
    Command.withDescription("project commands"),
    Command.withSubcommands([listCommand, addCommand]),
  );
}

const listCommand = Command.make(
  "list",
  {
    format: Flag.choice("format", ["human", "json"] as const).pipe(Flag.withDefault("human")),
  },
  ({ format }) =>
    Effect.gen(function* () {
      const domain = yield* T3Domain;
      const output = yield* T3Output;
      const snapshot = yield* domain.loadShell();
      if (format === "json") yield* output.printJson(snapshot.projects);
      else yield* output.writeStdout(formatProjectsHuman(snapshot.projects));
    }),
).pipe(Command.withDescription("list projects"));

const addCommand = Command.make(
  "add",
  {
    path: Argument.string("path"),
    title: Flag.string("title").pipe(Flag.optional),
    format: Flag.choice("format", ["human", "json"] as const).pipe(Flag.withDefault("human")),
  },
  ({ path, title, format }) =>
    Effect.gen(function* () {
      const domain = yield* T3Domain;
      const output = yield* T3Output;
      const titleValue = Option.getOrUndefined(title);
      const result = yield* domain.addProject({
        path,
        ...(titleValue ? { title: titleValue } : {}),
      });
      if (format === "json") yield* output.printJson(result);
      else yield* output.printInfo(formatProjectAddedHuman(result.project));
    }),
).pipe(Command.withDescription("add project"));
