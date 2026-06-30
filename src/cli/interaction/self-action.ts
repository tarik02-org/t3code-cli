import * as Effect from "effect/Effect";

import { SelfActionError } from "../error.ts";
import { isAgentEnvironment } from "../format/output.ts";
import type { T3CliEnvShape } from "../../config/env/env.ts";
import type { CliRuntime } from "../runtime/service.ts";

export const requireSelfActionConfirmation = Effect.fn("requireSelfActionConfirmation")(
  function* (input: {
    readonly threadId: string;
    readonly force: boolean;
    readonly cliRuntime: CliRuntime["Service"];
    readonly t3CliEnv: T3CliEnvShape;
    readonly action: string;
  }) {
    if (input.force) {
      return;
    }
    if (!isAgentEnvironment(input.t3CliEnv)) {
      return;
    }
    const callerThreadId = input.t3CliEnv.scope.t3codeThreadId;
    if (callerThreadId === undefined || callerThreadId.length === 0) {
      return;
    }
    if (input.threadId !== callerThreadId) {
      return;
    }
    yield* Effect.fail(
      new SelfActionError({
        threadId: input.threadId,
        message: `cannot ${input.action} thread ${input.threadId}: command targets the calling thread. Pass --force to confirm.`,
      }),
    );
  },
);
