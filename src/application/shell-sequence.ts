import * as Effect from "effect/Effect";

import type { Orchestration } from "../orchestration/service.ts";

export function waitForShellSequence(input: {
  readonly orchestration: Orchestration;
  readonly sequence: number;
}) {
  return Effect.gen(function* () {
    let snapshot = yield* input.orchestration.getShellSnapshot();
    while (snapshot.snapshotSequence < input.sequence) {
      yield* Effect.sleep("250 millis");
      snapshot = yield* input.orchestration.getShellSnapshot();
    }
    return snapshot;
  });
}
