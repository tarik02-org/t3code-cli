import "vite-plus/test/config";

import { assert, describe, it } from "@effect/vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import type { OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { formatThreadsHuman } from "./thread.ts";

describe("formatThreadsHuman", () => {
  it("appends (archived) for archived threads", () => {
    const threads: OrchestrationV2ThreadShell[] = [
      fromPartial({
        id: "active-1",
        title: "Active thread",
        status: "idle",
        archivedAt: null,
        updatedAt: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"),
        pendingRuntimeRequest: null,
      }),
      fromPartial({
        id: "archived-1",
        title: "Archived thread",
        status: "idle",
        archivedAt: DateTime.makeUnsafe("2026-01-02T00:00:00.000Z"),
        updatedAt: DateTime.makeUnsafe("2026-01-02T00:00:00.000Z"),
        pendingRuntimeRequest: null,
      }),
    ];

    const output = formatThreadsHuman(threads);
    assert.include(output, "title            id          status  updated                   flags");
    assert.include(output, "Active thread    active-1");
    assert.include(output, "Archived thread  archived-1");
    assert.include(output, "archived");
  });
});
