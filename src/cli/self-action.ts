import * as Effect from "effect/Effect";

import { SelfActionError } from "./error.ts";
import { isAgentEnvironment } from "./output-format.ts";
import type { EnvironmentShape } from "../environment/service.ts";

export function resolveCallerThreadId(
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const fromEnv = env.T3CODE_THREAD_ID;
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }
  return undefined;
}

export const requireSelfActionConfirmation = Effect.fn("requireSelfActionConfirmation")(
  function* (input: {
    readonly targetThreadId: string;
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
    const callerThreadId = resolveCallerThreadId(input.environment.env);
    if (callerThreadId === undefined || callerThreadId !== input.targetThreadId) {
      return;
    }
    yield* Effect.fail(
      new SelfActionError({
        threadId: input.targetThreadId,
        message: `cannot ${input.action} thread ${input.targetThreadId}: command targets the calling thread; pass --force to confirm`,
      }),
    );
  },
);
