import * as Effect from "effect/Effect";
import { Command, Flag } from "effect/unstable/cli";

import type { ListThreadsInclude } from "../../application/service.ts";
import { extraArgsConfig } from "../extra-args.ts";
import { formatFlag, projectFlag } from "../flags.ts";
import { InvalidFlagCombinationError } from "../error.ts";
import { requireCommandProjectRef } from "../require.ts";
import { formatThreadsHuman } from "../format/thread.ts";
import { T3Application } from "../../application/service.ts";
import { CliRuntime } from "../../cli/runtime/service.ts";
import { loadT3CliEnv } from "../../config/env/env.ts";
import { resolveOutputFormat } from "../format/output.ts";
import { T3Output } from "../output/service.ts";

export const listThreadsCommand = Command.make(
  "list",
  {
    project: projectFlag,
    archived: Flag.boolean("archived").pipe(Flag.withDescription("List archived threads only")),
    all: Flag.boolean("all").pipe(Flag.withDescription("List active and archived threads")),
    format: formatFlag,
    ...extraArgsConfig,
  },
  ({ project, archived, all, format }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      const cliRuntime = yield* CliRuntime;
      const t3CliEnv = yield* loadT3CliEnv;
      const output = yield* T3Output;
      if (archived && all) {
        yield* Effect.fail(
          new InvalidFlagCombinationError({
            message: "--archived and --all are mutually exclusive",
          }),
        );
      }
      const include: ListThreadsInclude = archived ? "archived" : all ? "all" : "active";
      const resolvedFormat = resolveOutputFormat(format, cliRuntime, t3CliEnv, "json");
      const projectRef = yield* requireCommandProjectRef({ project });
      const result = yield* application.listThreads(projectRef, { include });
      if (resolvedFormat === "json") {
        yield* output.printJson(result.threads);
      } else {
        yield* output.writeStdout(formatThreadsHuman(result.threads));
      }
    }),
).pipe(Command.withDescription("list project threads"));
