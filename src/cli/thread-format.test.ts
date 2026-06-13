import "vite-plus/test/config";

import { assert, describe, it } from "@effect/vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import type { OrchestrationThreadShell } from "#t3tools/contracts";

import { formatThreadsHuman } from "./thread-format.ts";

describe("formatThreadsHuman", () => {
  it("appends (archived) for archived threads", () => {
    const threads: OrchestrationThreadShell[] = [
      fromPartial({
        id: "active-1",
        title: "Active thread",
        archivedAt: null,
        updatedAt: "2026-01-01T00:00:00.000Z",
        session: null,
      }),
      fromPartial({
        id: "archived-1",
        title: "Archived thread",
        archivedAt: "2026-01-02T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        session: null,
      }),
    ];

    const output = formatThreadsHuman(threads);
    assert.include(output, "- Active thread\n");
    assert.include(output, "- Archived thread (archived)\n");
  });
});
