import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Command, Flag } from "effect/unstable/cli";

import { extraArgsConfig } from "../extra-args.ts";
import { formatFlag, threadFlag } from "../flags.ts";
import { MissingRequestError, MissingThreadError } from "../error.ts";
import { resolveThreadId } from "../scope/index.ts";
import { T3Application } from "../../application/service.ts";
import { CliRuntime } from "../../cli/runtime/service.ts";
import { loadT3CliEnv } from "../../config/env/env.ts";
import { resolveOutputFormat } from "../format/output.ts";
import { T3Output } from "../output/service.ts";

const approvalDecisionFlag = Flag.choice("decision", ["accept", "decline", "cancel"] as const).pipe(
  Flag.withDescription("Approval decision"),
);

const requestFlag = Flag.string("request").pipe(
  Flag.withDescription("Pending approval request id"),
  Flag.optional,
);

export const approveThreadCommand = Command.make(
  "approve",
  {
    thread: threadFlag,
    request: requestFlag,
    decision: approvalDecisionFlag,
    format: formatFlag,
    ...extraArgsConfig,
  },
  ({ thread, request, decision, format }) =>
    Effect.gen(function* () {
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
      const result = yield* application.approveThread({ threadId, requestId, decision });
      if (resolvedFormat === "json") {
        return yield* output.printJson(result);
      }
      return yield* output.printInfo(
        `approval submitted: ${result.requestId} (sequence ${result.dispatch.sequence})`,
      );
    }),
).pipe(Command.withDescription("respond to a pending approval request"));
