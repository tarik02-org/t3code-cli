import * as Effect from "effect/Effect";
import { Command } from "effect/unstable/cli";

import { extraArgsConfig } from "../extra-args.ts";
import { formatTerminalListHuman } from "../terminal-format.ts";
import { T3Application } from "../../application/service.ts";
import { Environment } from "../../environment/service.ts";
import { formatFlag, threadFlag } from "../flags.ts";
import { resolveOutputFormat } from "../output-format.ts";
import { T3Output } from "../output/service.ts";
import { requireCommandThreadId } from "./scope.ts";

export const listTerminalCommand = Command.make(
  "list",
  {
    thread: threadFlag,
    format: formatFlag,
    ...extraArgsConfig,
  },
  ({ thread, format }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      const environment = yield* Environment;
      const output = yield* T3Output;
      const threadId = yield* requireCommandThreadId({
        thread,
        env: environment.env,
      });
      const resolvedFormat = resolveOutputFormat(format, environment, "json");
      const terminals = yield* application.listTerminals(threadId);
      if (resolvedFormat === "json") {
        yield* output.printJson(terminals);
      } else {
        yield* output.writeStdout(formatTerminalListHuman(terminals));
      }
    }),
).pipe(Command.withDescription("list terminals for a thread"));
