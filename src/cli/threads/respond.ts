import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Command, Flag } from "effect/unstable/cli";

import { formatFlag, threadFlag } from "../flags.ts";
import { MissingRequestError, MissingThreadError } from "../error.ts";
import { readJsonAnswers } from "../message-input.ts";
import { resolveThreadId } from "../scope/index.ts";
import { T3Application } from "../../application/service.ts";
import { CliRuntime } from "../../cli/runtime/service.ts";
import { loadT3CliEnv } from "../../config/env/env.ts";
import { T3Input } from "../input/service.ts";
import { resolveOutputFormat } from "../format/output.ts";
import { T3Output } from "../output/service.ts";

const requestFlag = Flag.string("request").pipe(
  Flag.withDescription("Pending user-input request id"),
  Flag.optional,
);

export const respondThreadCommand = Command.make(
  "respond",
  {
    thread: threadFlag,
    request: requestFlag,
    answers: Flag.string("answers").pipe(Flag.optional),
    stdin: Flag.boolean("stdin"),
    format: formatFlag,
  },
  ({ thread, request, answers, stdin, format }) =>
    Effect.gen(function* () {
      const inputService = yield* T3Input;
      const parsedAnswers = yield* readJsonAnswers({
        answers: Option.getOrUndefined(answers),
        fromStdin: stdin,
        readStdin: inputService.readStdin,
      });
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
      const requestId = Option.getOrUndefined(request);
      if (requestId === undefined || requestId.length === 0) {
        return yield* Effect.fail(
          new MissingRequestError({ message: "request id is required: pass --request" }),
        );
      }
      const resolvedFormat = resolveOutputFormat(format, cliRuntime, t3CliEnv, "json");
      const result = yield* application.respondToThread({
        threadId,
        requestId,
        answers: parsedAnswers,
      });
      if (resolvedFormat === "json") {
        return yield* output.printJson(result);
      }
      return yield* output.printInfo(
        `user input submitted: ${result.requestId} (sequence ${result.dispatch.sequence})`,
      );
    }),
).pipe(Command.withDescription("respond to a pending user-input request"));
