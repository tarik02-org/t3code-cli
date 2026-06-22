import * as Effect from "effect/Effect";
import { Command } from "effect/unstable/cli";

import { formatTerminalListHuman } from "../format/terminal.ts";
import { T3Application } from "../../application/service.ts";
import { CliRuntime } from "../../cli/runtime/service.ts";
import { loadT3CliEnv } from "../../config/env/env.ts";
import { formatFlag, threadFlag } from "../flags.ts";
import { resolveOutputFormat } from "../format/output.ts";
import { T3Output } from "../output/service.ts";
import { requireCommandThreadId } from "./scope.ts";

export const listTerminalCommand = Command.make(
  "list",
  {
    thread: threadFlag,
    format: formatFlag,
  },
  ({ thread, format }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      const cliRuntime = yield* CliRuntime;
      const t3CliEnv = yield* loadT3CliEnv;
      const output = yield* T3Output;
      const threadId = yield* requireCommandThreadId({ thread });
      const resolvedFormat = resolveOutputFormat(format, cliRuntime, t3CliEnv, "json");
      const terminals = yield* application.listTerminals(threadId);
      if (resolvedFormat === "json") {
        yield* output.printJson(terminals);
      } else {
        yield* output.writeStdout(formatTerminalListHuman(terminals));
      }
    }),
).pipe(Command.withDescription("list terminals for a thread"));
