import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { ORCHESTRATION_WS_METHODS } from "@t3tools/contracts";

import type { Orchestration } from "../orchestration/service.ts";
import { RpcError } from "../rpc/error.ts";

export function waitForShellSequence(input: {
  readonly orchestration: Orchestration;
  readonly sequence: number;
}) {
  return Effect.gen(function* () {
    const sequence = yield* input.orchestration.watchShellSequence().pipe(
      Stream.filter((snapshotSequence) => snapshotSequence >= input.sequence),
      Stream.runHead,
      Effect.scoped,
    );
    if (Option.isNone(sequence)) {
      return yield* Effect.fail(
        new RpcError({
          message: `shell stream ended before sequence ${input.sequence}`,
          method: ORCHESTRATION_WS_METHODS.subscribeShell,
        }),
      );
    }
    return yield* input.orchestration.getShellSnapshot();
  });
}
