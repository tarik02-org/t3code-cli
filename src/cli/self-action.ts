import * as Effect from "effect/Effect";

import { SelfActionError } from "./error.ts";
import { isAgentEnvironment } from "./output-format.ts";
import type { EnvironmentShape } from "../environment/service.ts";

export const requireSelfActionConfirmation = Effect.fn("requireSelfActionConfirmation")(
  function* (input: {
    readonly threadId: string;
    readonly force: boolean;
    readonly environment: EnvironmentShape;
    readonly action: string;
  }) {
    if (input.force) {
      return;
    }
    if (!isAgentEnvironment(input.environment)) {
      return;
    }
    const callerThreadId = input.environment.env.T3CODE_THREAD_ID;
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
