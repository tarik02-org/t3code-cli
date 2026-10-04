import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Command, Flag } from "effect/unstable/cli";

import { extraArgsConfig } from "../extra-args.ts";
import { formatFlag, threadFlag } from "../flags.ts";
import { InvalidFlagCombinationError, InvalidLimitError } from "../error.ts";
import { MissingThreadError } from "../error.ts";
import { resolveThreadId } from "../scope/index.ts";
import { formatThreadTranscriptHuman, formatThreadTranscriptJson } from "../format/thread.ts";
import { T3Application } from "../../application/service.ts";
import { CliRuntime } from "../../cli/runtime/service.ts";
import { loadT3CliEnv } from "../../config/env/env.ts";
import { resolveOutputFormat } from "../format/output.ts";
import { T3Output } from "../output/service.ts";

export const getThreadTranscriptCommand = Command.make(
  "transcript",
  {
    thread: threadFlag,
    limit: Flag.Int("limit").pipe(Flag.withDefault(20)),
    beforeCursor: Flag.String("before-cursor").pipe(Flag.optional),
    all: Flag.Boolean("all").pipe(Flag.withDefault(false)),
    full: Flag.Boolean("full").pipe(Flag.withDefault(false)),
    format: formatFlag,
    ...extraArgsConfig,
  },
  ({ thread, limit, beforeCursor, all, full, format }) =>
    Effect.gen(function* () {
      if (limit < 0) {
        return yield* Effect.fail(
          new InvalidLimitError({ message: `invalid limit: ${limit}`, value: String(limit) }),
        );
      }
      const beforeCursorValue = Option.getOrUndefined(beforeCursor);
      if (all && beforeCursorValue !== undefined) {
        return yield* Effect.fail(
          new InvalidFlagCombinationError({
            message: "--all cannot be combined with --before-cursor",
          }),
        );
      }
      const application = yield* T3Application;
      const cliRuntime = yield* CliRuntime;
      const t3CliEnv = yield* loadT3CliEnv;
      const output = yield* T3Output;
      const threadId = resolveThreadId({
        value: Option.getOrUndefined(thread),
        scope: t3CliEnv.scope,
      });
      if (threadId === undefined) {
        return yield* Effect.fail(
          new MissingThreadError({
            message: "thread id is required: pass --thread or set T3CODE_THREAD_ID",
          }),
        );
      }
      const resolvedFormat = resolveOutputFormat(format, cliRuntime, t3CliEnv, "json");
      const transcript = yield* application.getThreadTranscript({
        threadId,
        ...(all ? { all: true } : {}),
        ...(beforeCursorValue !== undefined ? { beforeCursor: beforeCursorValue } : {}),
      });
      if (resolvedFormat === "json") {
        return yield* output.printJson(formatThreadTranscriptJson(transcript, full));
      }
      return yield* output.writeStdout(formatThreadTranscriptHuman(transcript, limit));
    }),
).pipe(Command.withDescription("get latest thread transcript"));
