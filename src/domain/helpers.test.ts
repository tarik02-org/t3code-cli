import "vite-plus/test/config";

import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { fromPartial } from "@total-typescript/shoehorn";

import type { OrchestrationShellSnapshot } from "#t3tools/contracts";

import { resolveProjectScope } from "./helpers.ts";

describe("resolveProjectScope", () => {
  it.layer(NodeServices.layer)("resolveProjectScope", (t) => {
    t.effect("resolves by id first (even if ref not absolute)", () =>
      Effect.gen(function* () {
        const snapshot: OrchestrationShellSnapshot = fromPartial({
          projects: [{ id: "proj-1", workspaceRoot: "/workspace" }],
          threads: [],
        });

        const scope = yield* resolveProjectScope(snapshot, { ref: "proj-1" });
        assert.equal(scope?.project.id, "proj-1");
        assert.equal(scope?.inferredWorktreePath, undefined);
      }),
    );

    t.effect("returns undefined for non-absolute path refs", () =>
      Effect.gen(function* () {
        const snapshot: OrchestrationShellSnapshot = fromPartial({
          projects: [{ id: "proj-1", workspaceRoot: "/workspace" }],
          threads: [],
        });

        const scope = yield* resolveProjectScope(snapshot, { ref: "workspace/subdir" });
        assert.equal(scope, undefined);
      }),
    );

    t.effect("prefers longest matching workspaceRoot", () =>
      Effect.gen(function* () {
        const snapshot: OrchestrationShellSnapshot = fromPartial({
          projects: [
            { id: "proj-a", workspaceRoot: "/workspace" },
            { id: "proj-b", workspaceRoot: "/workspace/sub" },
          ],
          threads: [],
        });

        const scope = yield* resolveProjectScope(snapshot, { ref: "/workspace/sub/deep" });
        assert.equal(scope?.project.id, "proj-b");
        assert.equal(scope?.inferredWorktreePath, "/workspace/sub/deep");
      }),
    );

    t.effect("does not infer worktree when ref equals workspaceRoot", () =>
      Effect.gen(function* () {
        const snapshot: OrchestrationShellSnapshot = fromPartial({
          projects: [
            { id: "proj-a", workspaceRoot: "/workspace" },
            { id: "proj-b", workspaceRoot: "/workspace/sub" },
          ],
          threads: [],
        });

        const scope = yield* resolveProjectScope(snapshot, { ref: "/workspace/sub" });
        assert.equal(scope?.project.id, "proj-b");
        assert.equal(scope?.inferredWorktreePath, undefined);
      }),
    );

    t.effect("prefers worktree candidate over project candidate for same match path", () =>
      Effect.gen(function* () {
        const snapshot: OrchestrationShellSnapshot = fromPartial({
          projects: [
            { id: "proj-a", workspaceRoot: "/workspace" },
            { id: "proj-b", workspaceRoot: "/workspace/proj" },
          ],
          threads: [{ projectId: "proj-a", worktreePath: "/workspace/proj" }],
        });

        const scope = yield* resolveProjectScope(snapshot, { ref: "/workspace/proj" });
        assert.equal(scope?.project.id, "proj-a");
        assert.equal(scope?.inferredWorktreePath, "/workspace/proj");
      }),
    );

    t.effect("prefers longest matching worktree path", () =>
      Effect.gen(function* () {
        const snapshot: OrchestrationShellSnapshot = fromPartial({
          projects: [{ id: "proj-a", workspaceRoot: "/workspace" }],
          threads: [
            { projectId: "proj-a", worktreePath: "/workspace/proj" },
            { projectId: "proj-a", worktreePath: "/workspace/proj/deep" },
          ],
        });

        const scope = yield* resolveProjectScope(snapshot, { ref: "/workspace/proj/deep/child" });
        assert.equal(scope?.project.id, "proj-a");
        assert.equal(scope?.inferredWorktreePath, "/workspace/proj/deep/child");
      }),
    );
  });
});
