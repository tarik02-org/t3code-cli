import * as Effect from "effect/Effect";
import { Command } from "effect/unstable/cli";

import { formatFlag, projectFlag } from "../flags.ts";
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
    format: formatFlag,
  },
  ({ project, format }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      const environment = yield* Environment;
      const output = yield* T3Output;
      const resolvedFormat = resolveOutputFormat(format, environment, "json");
      const projectRef = yield* requireCommandProjectRef({
        project,
        env: environment.env,
        cwd: environment.cwd,
      });
      const result = yield* application.listThreads(projectRef);
      if (resolvedFormat === "json") {
        yield* output.printJson(result.threads);
      } else {
        yield* output.writeStdout(formatThreadsHuman(result.threads));
      }
    }),
).pipe(Command.withDescription("list project threads"));
