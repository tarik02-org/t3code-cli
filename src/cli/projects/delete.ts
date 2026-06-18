import * as Effect from "effect/Effect";
import { Command } from "effect/unstable/cli";

import { requireDestructiveConfirmation } from "../confirm.ts";
import { extraArgsConfig } from "../extra-args.ts";
import { forceFlag, formatFlag, projectFlag, yesFlag } from "../flags.ts";
import { formatProjectDeletedHuman } from "../project-format.ts";
import { requireCommandProjectRef } from "../require.ts";
import { T3Application } from "../../application/service.ts";
import { Environment } from "../../environment/service.ts";
import { resolveOutputFormat } from "../output-format.ts";
import { T3Output } from "../output/service.ts";

export const deleteProjectCommand = Command.make(
  "delete",
  {
    project: projectFlag,
    force: forceFlag,
    yes: yesFlag,
    format: formatFlag,
    ...extraArgsConfig,
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
      const resolvedProject = yield* application.resolveProject(projectRef);
      yield* requireDestructiveConfirmation({
        message: `Delete project ${resolvedProject.title} (${resolvedProject.id})?`,
        yes,
        environment,
      });
      const resolvedFormat = resolveOutputFormat(format, environment, "json");
      const result = yield* application.deleteProject({
        projectId: resolvedProject.id,
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
