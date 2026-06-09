import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { T3Config } from "../config/service.ts";
import { ProjectLookupError } from "../domain/error.ts";

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

export const resolveCommandProjectRef = Effect.fn("resolveCommandProjectRef")(function* (input: {
  readonly project: Option.Option<string>;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
}) {
  const explicit = resolveProjectRef(input.project, input.env);
  if (explicit !== undefined) {
    return explicit;
  }
  const config = yield* T3Config;
  const resolved = yield* config.resolve();
  if (resolved.local) {
    return input.cwd;
  }
  return undefined;
});

export const requireCommandProjectRef = Effect.fn("requireCommandProjectRef")(function* (input: {
  readonly project: Option.Option<string>;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
}) {
  const ref = yield* resolveCommandProjectRef(input);
  if (ref === undefined) {
    return yield* Effect.fail(
      new ProjectLookupError({
        message:
          "project is required: pass --project, set T3CODE_PROJECT_ROOT / T3CODE_PROJECT_ID, or use local auth",
        ref: input.cwd,
      }),
    );
  }
  return ref;
});

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
): string | undefined {
  const fromFlag = Option.getOrUndefined(flag);
  if (fromFlag !== undefined && fromFlag.length > 0) {
    return fromFlag;
  }
  const fromEnv = env.T3CODE_THREAD_ID;
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }
  return undefined;
}
