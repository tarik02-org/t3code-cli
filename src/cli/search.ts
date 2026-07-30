import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { T3Application } from "../application/service.ts";
import { loadT3CliEnv } from "../config/env/env.ts";
import { InvalidLimitError } from "./error.ts";
import { extraArgsConfig } from "./extra-args.ts";
import { formatFlag } from "./flags.ts";
import { formatThreadSearchHuman } from "./format/thread.ts";
import { resolveOutputFormat } from "./format/output.ts";
import { T3Output } from "./output/service.ts";
import { CliRuntime } from "./runtime/service.ts";

export const searchThreadsCommand = Command.make(
  "search",
  {
    query: Argument.string("query"),
    limit: Flag.integer("limit").pipe(
      Flag.withDescription("Maximum matches (1-50, default: 50)"),
      Flag.optional,
    ),
    format: formatFlag,
    ...extraArgsConfig,
  },
  ({ query, limit, format }) =>
    Effect.gen(function* () {
      const value = Option.getOrUndefined(limit);
      if (value !== undefined && (value < 1 || value > 50)) {
        return yield* Effect.fail(
          new InvalidLimitError({ message: `invalid limit: ${value}`, value: String(value) }),
        );
      }
      const application = yield* T3Application;
      const cliRuntime = yield* CliRuntime;
      const t3CliEnv = yield* loadT3CliEnv;
      const output = yield* T3Output;
      const resolvedFormat = resolveOutputFormat(format, cliRuntime, t3CliEnv, "json");
      const matches = yield* application.searchThreads({
        query,
        ...(value !== undefined ? { limit: value } : {}),
      });
      if (resolvedFormat === "json") {
        return yield* output.printJson(matches);
      }
      return yield* output.writeStdout(formatThreadSearchHuman(matches));
    }),
).pipe(Command.withDescription("search threads by conversation content"));
