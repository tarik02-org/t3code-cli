import * as Effect from "effect/Effect";
import { Command } from "effect/unstable/cli";

import { extraArgsConfig } from "../extra-args.ts";
import { requireDestructiveConfirmation } from "../interaction/confirm.ts";
import { forceFlag, formatFlag, projectFlag, yesFlag } from "../flags.ts";
import { formatProjectDeletedHuman } from "../format/project.ts";
import { requireCommandProjectRef } from "../require.ts";
import { T3Application } from "../../application/service.ts";
import { CliRuntime } from "../../cli/runtime/service.ts";
import { loadT3CliEnv } from "../../config/env/env.ts";
import { resolveOutputFormat } from "../format/output.ts";
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
      const cliRuntime = yield* CliRuntime;
      const t3CliEnv = yield* loadT3CliEnv;
      const output = yield* T3Output;
      const projectRef = yield* requireCommandProjectRef({ project });
      const resolvedProject = yield* application.resolveProject(projectRef);
      yield* requireDestructiveConfirmation({
        message: `Delete project ${resolvedProject.title} (${resolvedProject.id})?`,
        yes,
        cliRuntime,
        t3CliEnv,
      });
      const resolvedFormat = resolveOutputFormat(format, cliRuntime, t3CliEnv, "json");
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
