import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { T3CliEnvScope } from "../../config/env/env.ts";
import { loadT3CliEnv } from "../../config/env/env.ts";
import { resolveThreadId } from "../scope/index.ts";
import { MissingThreadError } from "../error.ts";

export function resolveCommandThreadId(input: {
  readonly thread: Option.Option<string>;
  readonly scope: T3CliEnvScope;
}): string | undefined {
  return resolveThreadId({
    value: Option.getOrUndefined(input.thread),
    scope: input.scope,
  });
}

export const requireCommandThreadId = Effect.fn("requireCommandThreadId")(function* (input: {
  readonly thread: Option.Option<string>;
}) {
  const t3CliEnv = yield* loadT3CliEnv;
  const threadId = resolveCommandThreadId({
    thread: input.thread,
    scope: t3CliEnv.scope,
  });
  if (threadId === undefined) {
    return yield* Effect.fail(
      new MissingThreadError({
        message: "thread id is required: pass --thread or set T3CODE_THREAD_ID",
      }),
    );
  }
  return threadId;
});
