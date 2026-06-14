import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { resolveThreadId } from "../../scope/index.ts";
import { MissingThreadError } from "../error.ts";

export function resolveCommandThreadId(input: {
  readonly thread: Option.Option<string>;
  readonly env: Readonly<Record<string, string | undefined>>;
}): string | undefined {
  return resolveThreadId({
    value: Option.getOrUndefined(input.thread),
    env: input.env,
  });
}

export const requireCommandThreadId = Effect.fn("requireCommandThreadId")(function* (input: {
  readonly thread: Option.Option<string>;
  readonly env: Readonly<Record<string, string | undefined>>;
}) {
  const threadId = resolveCommandThreadId(input);
  if (threadId === undefined) {
    return yield* Effect.fail(
      new MissingThreadError({
        message: "thread id is required: pass --thread or set T3CODE_THREAD_ID",
      }),
    );
  }
  return threadId;
});
