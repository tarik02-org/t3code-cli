import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { MissingThreadError } from "./error.ts";

export function resolveProjectRef(
  flag: Option.Option<string>,
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const fromFlag = Option.getOrUndefined(flag);
  if (fromFlag !== undefined && fromFlag.length > 0) {
    return fromFlag;
  }
  const fromRoot = env.T3CODE_PROJECT_ROOT;
  if (fromRoot !== undefined && fromRoot.length > 0) {
    return fromRoot;
  }
  const fromId = env.T3CODE_PROJECT_ID;
  if (fromId !== undefined && fromId.length > 0) {
    return fromId;
  }
  return undefined;
}

export function resolveWorktreePath(
  flag: Option.Option<string>,
  env: Readonly<Record<string, string | undefined>>,
  inferred?: string,
): string | undefined {
  const fromFlag = Option.getOrUndefined(flag);
  if (fromFlag !== undefined && fromFlag.length > 0) {
    return fromFlag;
  }
  const fromEnv = env.T3CODE_WORKTREE_PATH;
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }
  return inferred;
}

export function resolveThreadId(
  flag: Option.Option<string>,
  env: Readonly<Record<string, string | undefined>>,
): Effect.Effect<string, MissingThreadError> {
  const fromFlag = Option.getOrUndefined(flag);
  if (fromFlag !== undefined && fromFlag.length > 0) {
    return Effect.succeed(fromFlag);
  }
  const fromEnv = env.T3CODE_THREAD_ID;
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return Effect.succeed(fromEnv);
  }
  return Effect.fail(
    new MissingThreadError({
      message: "thread id is required: pass --thread or set T3CODE_THREAD_ID",
    }),
  );
}
