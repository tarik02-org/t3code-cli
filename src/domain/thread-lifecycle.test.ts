import "vite-plus/test/config";

import { describe, expect, it } from "vite-plus/test";
import { fromPartial } from "@total-typescript/shoehorn";

import type { OrchestrationThread } from "@t3tools/contracts";

import { isThreadActive, isThreadCompleteEnough } from "./thread-lifecycle.ts";

describe("thread lifecycle", () => {
  it("treats a ready session with a stale running latestTurn as complete", () => {
    const thread = fromPartial<OrchestrationThread>({
      session: {
        status: "ready",
      },
      latestTurn: {
        state: "running",
      },
      messages: [
        {
          role: "user",
          text: "run review",
        },
        {
          role: "assistant",
          text: "verdict: requested changes",
          streaming: false,
        },
      ],
    });

    expect(isThreadCompleteEnough(thread)).toBe(true);
    expect(isThreadActive(thread)).toBe(false);
  });
});
