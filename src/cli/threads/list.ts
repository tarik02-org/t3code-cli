import * as Effect from "effect/Effect";
import { Command, Flag } from "effect/unstable/cli";

import type { ListThreadsInclude } from "../../application/service.ts";
import { formatFlag, projectFlag } from "../flags.ts";
import { InvalidFlagCombinationError } from "../error.ts";
import { requireCommandProjectRef } from "../require.ts";
import { formatThreadsHuman } from "../thread-format.ts";
import { T3Application } from "../../application/service.ts";
import { Environment } from "../../environment/service.ts";
import { resolveOutputFormat } from "../output-format.ts";
import { T3Output } from "../output/service.ts";

export const listThreadsCommand = Command.make(
  "list",
  {
    project: projectFlag,
    archived: Flag.boolean("archived").pipe(
      Flag.withDescription("List archived threads only"),
    ),
    all: Flag.boolean("all").pipe(Flag.withDescription("List active and archived threads")),
    format: formatFlag,
  },
  ({ project, archived, all, format }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      const environment = yield* Environment;
      const output = yield* T3Output;
      if (archived && all) {
        yield* Effect.fail(
          new InvalidFlagCombinationError({
            message: "--archived and --all are mutually exclusive",
          }),
        );
      }
      const include: ListThreadsInclude = archived ? "archived" : all ? "all" : "active";
      const resolvedFormat = resolveOutputFormat(format, environment, "json");
      const projectRef = yield* requireCommandProjectRef({
        project,
        env: environment.env,
        cwd: environment.cwd,
      });
      const result = yield* application.listThreads(projectRef, { include });
      if (resolvedFormat === "json") {
        yield* output.printJson(result.threads);
      } else {
        yield* output.writeStdout(formatThreadsHuman(result.threads));
      }
    }),
).pipe(Command.withDescription("list project threads"));
