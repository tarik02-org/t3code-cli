import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { Command, Flag } from "effect/unstable/cli";

import { forceFlag, formatFlag, projectFlag, projectPathFlag, yesFlag } from "./flags.ts";
import { requireDestructiveConfirmation } from "./confirm.ts";
import {
  formatProjectAddedHuman,
  formatProjectDeletedHuman,
  formatProjectsHuman,
} from "./project-format.ts";
import { requireCommandProjectRef } from "./require.ts";
import { T3Application } from "../application/service.ts";
import { resolveProjectScope } from "../domain/helpers.ts";
import { Environment } from "../environment/service.ts";
import { resolveOutputFormat } from "./output-format.ts";
import { T3Output } from "./output/service.ts";

export function createProjectCommand() {
  return Command.make("project").pipe(
    Command.withDescription("project commands"),
    Command.withSubcommands([listCommand, addCommand, deleteCommand]),
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

const deleteCommand = Command.make(
  "delete",
  {
    project: projectFlag,
    force: forceFlag,
    yes: yesFlag,
    format: formatFlag,
  },
  ({ project, force, yes, format }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      const environment = yield* Environment;
      const output = yield* T3Output;
      const projectRef = yield* requireCommandProjectRef({
        project,
        env: environment.env,
        cwd: environment.cwd,
      });
      const snapshot = yield* application.loadShell();
      const path = yield* Path.Path;
      const scope = yield* resolveProjectScope(snapshot, { ref: projectRef }).pipe(
        Effect.provideService(Path.Path, path),
      );
      const projectTitle = scope?.project.title ?? projectRef;
      const projectId = scope?.project.id ?? projectRef;
      yield* requireDestructiveConfirmation({
        message: `Delete project ${projectTitle} (${projectId})?`,
        yes,
        environment,
      });
      const resolvedFormat = resolveOutputFormat(format, environment, "json");
      const result = yield* application.deleteProject({
        projectRef,
        ...(force ? { force: true } : {}),
      });
      if (resolvedFormat === "json") {
        return yield* output.printJson({
          projectId: result.projectId,
          dispatch: result.dispatch,
        });
      }
      return yield* output.printInfo(formatProjectDeletedHuman(result));
    }),
).pipe(Command.withDescription("delete project"));
