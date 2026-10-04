import "vite-plus/test/config";

import * as DateTime from "effect/DateTime";
import { assert, describe, it } from "@effect/vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import type { OrchestrationV2Run, OrchestrationV2ThreadProjection } from "@t3tools/contracts";

import { threadStatus } from "./thread-lifecycle.ts";

const at = DateTime.makeUnsafe("2026-01-01T00:00:00.000Z");

function run(
  ordinal: number,
  status: OrchestrationV2Run["status"],
  started: boolean,
): OrchestrationV2Run {
  return fromPartial({
    id: `run-${ordinal}`,
    ordinal,
    status,
    requestedAt: at,
    startedAt: started ? at : null,
    completedAt: at,
  });
}

describe("threadStatus", () => {
  it("reports the run that ran when a newer queued run was steered away", () => {
    const projection = fromPartial<OrchestrationV2ThreadProjection>({
      thread: { providerInstanceId: "codex", activeProviderThreadId: "provider-thread" },
      runs: [run(1, "completed", true), run(2, "cancelled", false)],
      messages: [],
      turnItems: [],
      providerSessions: [],
      providerThreads: [],
      updatedAt: at,
    });
    assert.equal(threadStatus(projection), "completed");
  });
});
