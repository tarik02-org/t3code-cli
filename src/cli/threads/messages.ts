import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Command, Flag } from "effect/unstable/cli";

import { extraArgsConfig } from "../extra-args.ts";
import { formatFlag, threadFlag } from "../flags.ts";
import { InvalidFlagCombinationError, InvalidLimitError } from "../error.ts";
import { MissingThreadError } from "../error.ts";
import { resolveThreadId } from "../scope/index.ts";
import { formatThreadMessagesHuman, formatThreadMessagesJson } from "../format/thread.ts";
import { T3Application } from "../../application/service.ts";
import { CliRuntime } from "../../cli/runtime/service.ts";
import { loadT3CliEnv } from "../../config/env/env.ts";
import { resolveOutputFormat } from "../format/output.ts";
import { T3Output } from "../output/service.ts";

export const getThreadTranscriptCommand = Command.make(
  "transcript",
  {
    thread: threadFlag,
    limit: Flag.integer("limit").pipe(Flag.withDefault(20)),
    turnLimit: Flag.integer("turn-limit").pipe(Flag.optional),
    beforeCursor: Flag.string("before-cursor").pipe(Flag.optional),
    all: Flag.boolean("all"),
    full: Flag.boolean("full"),
    format: formatFlag,
    ...extraArgsConfig,
  },
  ({ thread, limit, turnLimit, beforeCursor, all, full, format }) =>
    Effect.gen(function* () {
      if (limit < 0) {
        return yield* Effect.fail(
          new InvalidLimitError({ message: `invalid limit: ${limit}`, value: String(limit) }),
        );
      }
      const turnLimitValue = Option.getOrUndefined(turnLimit);
      const beforeCursorValue = Option.getOrUndefined(beforeCursor);
      if (turnLimitValue !== undefined && turnLimitValue <= 0) {
        return yield* Effect.fail(
          new InvalidLimitError({
            message: `invalid turn limit: ${turnLimitValue}`,
            value: String(turnLimitValue),
          }),
        );
      }
      if (all && (turnLimitValue !== undefined || beforeCursorValue !== undefined)) {
        return yield* Effect.fail(
          new InvalidFlagCombinationError({
            message: "--all cannot be combined with --turn-limit or --before-cursor",
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
      const detail = yield* application.getThreadMessages({
        threadId,
        ...(!all
          ? {
              window: {
                turnLimit: turnLimitValue ?? (beforeCursorValue === undefined ? 10 : 20),
                ...(beforeCursorValue !== undefined ? { beforeCursor: beforeCursorValue } : {}),
              },
            }
          : {}),
      });
      if (resolvedFormat === "json") {
        return yield* output.printJson(formatThreadMessagesJson(detail, full));
      }
      return yield* output.writeStdout(formatThreadMessagesHuman(detail, limit));
    }),
).pipe(Command.withDescription("get latest thread transcript"));
