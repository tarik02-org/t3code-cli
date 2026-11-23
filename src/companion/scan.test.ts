import "vite-plus/test/config";

import * as DateTime from "effect/DateTime";
import { assert, describe, it } from "@effect/vitest";

import { type ScannedItem, sentTargets } from "./scan.ts";

const tool = (ordinal: number, toolName: string, rest: Partial<ScannedItem> = {}): ScannedItem => ({
  type: "dynamic_tool",
  ordinal,
  status: "completed",
  startedAt: DateTime.makeUnsafe(ordinal * 1000),
  toolName,
  ...rest,
});

describe("sentTargets", () => {
  it("finds the threads a caller launched and wrote to, whatever MCP server it used", () => {
    const found = sentTargets(
      [
        tool(1, "mcp__agx-t3__t3_thread_launch", { output: { threadId: "launched" } }),
        tool(2, "mcp__t3-code__t3_thread_send", { input: { threadId: "written" } }),
        tool(3, "mcp__t3-code__create_threads", {
          output: { threads: [{ threadId: "one" }, { threadId: "two" }] },
        }),
        tool(4, "mcp__agx-t3__t3_thread_read", { input: { threadId: "only-read" } }),
        tool(5, "mcp__agx-t3__t3_thread_send", { status: "failed", input: { threadId: "no" } }),
        { type: "assistant_message", ordinal: 6, status: "completed" },
      ],
      0,
    );
    assert.deepEqual(
      found.targets.map((target) => `${target.origin} ${target.threadId} @${target.atMs}`),
      ["launched launched @1000", "sent written @2000", "launched one @3000", "launched two @3000"],
    );
    assert.equal(found.cursor, 6);
  });

  it("reads only past the cursor, and stops before a send still under way", () => {
    const items = [
      tool(1, "t3_thread_send", { input: { threadId: "old" } }),
      tool(2, "t3_thread_send", { input: { threadId: "new" } }),
      tool(3, "t3_thread_launch", { status: "running" }),
      tool(4, "t3_thread_send", { input: { threadId: "later" } }),
    ];
    const found = sentTargets(items, 1);
    assert.deepEqual(
      found.targets.map((target) => target.threadId),
      ["new"],
    );
    assert.equal(found.cursor, 2);
  });
});
