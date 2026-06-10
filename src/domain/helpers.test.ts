import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "vite-plus/test";

import type { OrchestrationShellSnapshot } from "#t3tools/contracts";

import { resolveProjectScope } from "./helpers.ts";

const run = (snapshot: OrchestrationShellSnapshot, ref: string) =>
  Effect.runPromise(
    resolveProjectScope(snapshot, { ref }).pipe(Effect.provide(NodeServices.layer)),
  );

describe("resolveProjectScope", () => {
  it("resolves by id first (even if ref not absolute)", async () => {
    const snapshot: OrchestrationShellSnapshot = JSON.parse(
      JSON.stringify({
        projects: [{ id: "proj-1", workspaceRoot: "/workspace" }],
        threads: [],
      }),
    );

    const scope = await run(snapshot, "proj-1");
    expect(scope?.project.id).toBe("proj-1");
    expect(scope?.inferredWorktreePath).toBeUndefined();
  });

  it("returns undefined for non-absolute path refs", async () => {
    const snapshot: OrchestrationShellSnapshot = JSON.parse(
      JSON.stringify({
        projects: [{ id: "proj-1", workspaceRoot: "/workspace" }],
        threads: [],
      }),
    );

    const scope = await run(snapshot, "workspace/subdir");
    expect(scope).toBeUndefined();
  });

  it("prefers longest matching workspaceRoot", async () => {
    const snapshot: OrchestrationShellSnapshot = JSON.parse(
      JSON.stringify({
        projects: [
          { id: "proj-a", workspaceRoot: "/workspace" },
          { id: "proj-b", workspaceRoot: "/workspace/sub" },
        ],
        threads: [],
      }),
    );

    const scope = await run(snapshot, "/workspace/sub/deep");
    expect(scope?.project.id).toBe("proj-b");
    expect(scope?.inferredWorktreePath).toBe("/workspace/sub/deep");
  });

  it("does not infer worktree when ref equals workspaceRoot", async () => {
    const snapshot: OrchestrationShellSnapshot = JSON.parse(
      JSON.stringify({
        projects: [
          { id: "proj-a", workspaceRoot: "/workspace" },
          { id: "proj-b", workspaceRoot: "/workspace/sub" },
        ],
        threads: [],
      }),
    );

    const scope = await run(snapshot, "/workspace/sub");
    expect(scope?.project.id).toBe("proj-b");
    expect(scope?.inferredWorktreePath).toBeUndefined();
  });

  it("prefers worktree candidate over project candidate for same match path", async () => {
    const snapshot: OrchestrationShellSnapshot = JSON.parse(
      JSON.stringify({
        projects: [
          { id: "proj-a", workspaceRoot: "/workspace" },
          { id: "proj-b", workspaceRoot: "/workspace/proj" },
        ],
        threads: [{ projectId: "proj-a", worktreePath: "/workspace/proj" }],
      }),
    );

    const scope = await run(snapshot, "/workspace/proj");
    expect(scope?.project.id).toBe("proj-a");
    expect(scope?.inferredWorktreePath).toBe("/workspace/proj");
  });

  it("prefers longest matching worktree path", async () => {
    const snapshot: OrchestrationShellSnapshot = JSON.parse(
      JSON.stringify({
        projects: [{ id: "proj-a", workspaceRoot: "/workspace" }],
        threads: [
          { projectId: "proj-a", worktreePath: "/workspace/proj" },
          { projectId: "proj-a", worktreePath: "/workspace/proj/deep" },
        ],
      }),
    );

    const scope = await run(snapshot, "/workspace/proj/deep/child");
    expect(scope?.project.id).toBe("proj-a");
    expect(scope?.inferredWorktreePath).toBe("/workspace/proj/deep/child");
  });
});
