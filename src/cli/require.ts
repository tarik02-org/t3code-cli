import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { T3Config } from "../config/service.ts";
import { ProjectLookupError } from "../domain/error.ts";
import { resolveCommandProjectRef } from "../scope/index.ts";

export const requireCommandProjectRef = Effect.fn("requireCommandProjectRef")(function* (input: {
  readonly project: Option.Option<string>;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
}) {
  const config = yield* T3Config;
  const resolved = yield* config.resolve();
  const ref = resolveCommandProjectRef({
    value: Option.getOrUndefined(input.project),
    env: input.env,
    cwd: input.cwd,
    isLocal: resolved.local,
  });
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
