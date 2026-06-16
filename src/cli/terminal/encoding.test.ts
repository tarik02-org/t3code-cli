import "vite-plus/test/config";

import { describe, expect, it } from "vite-plus/test";

import { decodeBase64Payload, decodeHexPayload } from "./encoding.ts";
import { filterAttachStreamEvent } from "./shared.ts";

describe("terminal encoding", () => {
  it("preserves non-utf8 bytes in hex payloads", () => {
    expect(decodeHexPayload("ff")).toBe("\xff");
  });

  it("preserves non-utf8 bytes in base64 payloads", () => {
    expect(decodeBase64Payload("/w==")).toBe("\xff");
  });
});

describe("filterAttachStreamEvent", () => {
  const snapshotEvent = {
    type: "snapshot" as const,
    snapshot: {
      threadId: "thread-1",
      terminalId: "term-1",
      cwd: "/tmp",
      worktreePath: null,
      status: "running" as const,
      pid: 1,
      history: "hello",
      exitCode: null,
      exitSignal: null,
      label: "shell",
      updatedAt: "2026-01-01T00:00:00.000Z",
      sequence: 3,
    },
  };

  it("keeps snapshot history when --history is set with --from-sequence", () => {
    const filtered = filterAttachStreamEvent(snapshotEvent, {
      includeHistory: true,
      fromSequence: 5,
    });
    expect(filtered?.type).toBe("snapshot");
    if (filtered?.type === "snapshot") {
      expect(filtered.snapshot.history).toBe("hello");
    }
  });

  it("filters sequenced events inclusively from --from-sequence", () => {
    const outputEvent = {
      type: "output" as const,
      threadId: "thread-1",
      terminalId: "term-1",
      sequence: 5,
      data: "x",
    };
    expect(
      filterAttachStreamEvent(outputEvent, { includeHistory: false, fromSequence: 5 }),
    ).toEqual(outputEvent);
    expect(
      filterAttachStreamEvent(outputEvent, { includeHistory: false, fromSequence: 6 }),
    ).toBeNull();
  });
});
