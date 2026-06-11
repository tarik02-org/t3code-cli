import * as Effect from "effect/Effect";

import { waitForThread } from "./thread-wait.ts";
import type { Orchestration } from "../orchestration/service.ts";
import type { SendThreadInput } from "./service.ts";

export type CallbackInput = {
  readonly orchestration: Orchestration;
  readonly fromThreadId: string;
  readonly targetThreadId: string;
  readonly prompt: string;
};

export function waitForThreadAndPrepareSend(input: CallbackInput) {
  return waitForThread({
    orchestration: input.orchestration,
    threadId: input.fromThreadId,
  }).pipe(
    Effect.flatMap(() => {
      const sendInput: SendThreadInput = {
        threadId: input.targetThreadId,
        message: input.prompt,
      };
      return Effect.succeed(sendInput);
    }),
  );
}
