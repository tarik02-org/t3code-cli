import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Command, Flag } from "effect/unstable/cli";

import { T3Application } from "../../application/service.ts";
import { CliRuntime } from "../runtime/service.ts";
import { T3Config } from "../../config/config.ts";
import { loadT3CliEnv } from "../../config/env/env.ts";
import { extraArgsConfig } from "../extra-args.ts";
import { ConflictingUpdateFlagsError, MissingUpdateFieldsError } from "../error.ts";
import { formatFlag, modelFlags, projectFlag } from "../flags.ts";
import { formatProjectUpdatedHuman } from "../format/project.ts";
import { resolveOutputFormat } from "../format/output.ts";
import { buildModelOptions } from "../model-options.ts";
import { T3Output } from "../output/service.ts";
import { requireCommandProjectRef } from "../require.ts";

export const updateProjectCommand = Command.make(
  "update",
  {
    project: projectFlag,
    title: Flag.string("title").pipe(Flag.optional),
    workspaceRoot: Flag.string("workspace-root").pipe(Flag.optional),
    provider: Flag.string("provider").pipe(Flag.optional),
    model: Flag.string("model").pipe(Flag.optional),
    ...modelFlags,
    clearDefaultModel: Flag.boolean("clear-default-model").pipe(Flag.optional),
    threadEnv: Flag.choice("thread-env", ["local", "worktree"] as const).pipe(Flag.optional),
    clearThreadEnv: Flag.boolean("clear-thread-env").pipe(Flag.optional),
    favicon: Flag.string("favicon").pipe(Flag.optional),
    clearFavicon: Flag.boolean("clear-favicon").pipe(Flag.optional),
    format: formatFlag,
    ...extraArgsConfig,
  },
  (flags) =>
    Effect.gen(function* () {
      const title = Option.getOrUndefined(flags.title);
      const workspaceRoot = Option.getOrUndefined(flags.workspaceRoot);
      const provider = Option.getOrUndefined(flags.provider);
      const model = Option.getOrUndefined(flags.model);
      const threadEnv = Option.getOrUndefined(flags.threadEnv);
      const favicon = Option.getOrUndefined(flags.favicon);
      const clearDefaultModel = Option.getOrUndefined(flags.clearDefaultModel) === true;
      const clearThreadEnv = Option.getOrUndefined(flags.clearThreadEnv) === true;
      const clearFavicon = Option.getOrUndefined(flags.clearFavicon) === true;
      const options = buildModelOptions(flags);
      const hasModel = provider !== undefined || model !== undefined || options.length > 0;

      if (hasModel && clearDefaultModel) {
        return yield* conflict("model flags and --clear-default-model are mutually exclusive");
      }
      if (threadEnv !== undefined && clearThreadEnv) {
        return yield* conflict("--thread-env and --clear-thread-env are mutually exclusive");
      }
      if (favicon !== undefined && clearFavicon) {
        return yield* conflict("--favicon and --clear-favicon are mutually exclusive");
      }
      if (
        title === undefined &&
        workspaceRoot === undefined &&
        !hasModel &&
        !clearDefaultModel &&
        threadEnv === undefined &&
        !clearThreadEnv &&
        favicon === undefined &&
        !clearFavicon
      ) {
        return yield* Effect.fail(
          new MissingUpdateFieldsError({
            message: "at least one project metadata update field is required",
          }),
        );
      }

      const application = yield* T3Application;
      const config = yield* T3Config;
      const runtime = yield* CliRuntime;
      const env = yield* loadT3CliEnv;
      const output = yield* T3Output;
      const result = yield* application.updateProject({
        projectRef: yield* requireCommandProjectRef({ project: flags.project }),
        local: (yield* config.resolve()).local,
        ...(title !== undefined ? { title } : {}),
        ...(workspaceRoot !== undefined ? { workspaceRoot } : {}),
        ...(provider !== undefined ? { provider } : {}),
        ...(model !== undefined ? { model } : {}),
        ...(options.length > 0 ? { options } : {}),
        ...(clearDefaultModel ? { defaultModelSelection: null } : {}),
        ...(clearThreadEnv
          ? { defaultThreadEnvironment: null }
          : threadEnv !== undefined
            ? { defaultThreadEnvironment: threadEnv }
            : {}),
        ...(clearFavicon ? { favicon: null } : favicon !== undefined ? { favicon } : {}),
      });
      if (resolveOutputFormat(flags.format, runtime, env, "json") === "json") {
        return yield* output.printJson(result.project);
      }
      return yield* output.printInfo(formatProjectUpdatedHuman(result.project));
    }),
).pipe(Command.withDescription("update project metadata"));

function conflict(message: string) {
  return Effect.fail(new ConflictingUpdateFlagsError({ message }));
}
