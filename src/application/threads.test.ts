import "vite-plus/test/config";

import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import type {
  OrchestrationV2Command,
  OrchestrationV2ShellSnapshot,
  OrchestrationV2ThreadProjection,
  OrchestrationV2ThreadShell,
} from "@t3tools/contracts";

import * as CliRuntime from "../cli/runtime/service.ts";
import { t3CliEnvConfigLayer } from "../config/env/env.test-utils.ts";
import { T3Orchestration, type Orchestration } from "../orchestration/service.ts";
import { makeThreadApplication } from "./threads.ts";

function makeThread(
  id: string,
  projectId: string,
  archivedAt: string | null,
): OrchestrationV2ThreadShell {
  return fromPartial({
    id,
    projectId,
    archivedAt: archivedAt === null ? null : DateTime.makeUnsafe(archivedAt),
    title: `thread-${id}`,
    updatedAt: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"),
  });
}

function makeSnapshot(threads: OrchestrationV2ThreadShell[]): OrchestrationV2ShellSnapshot {
  return fromPartial({
    projects: [{ id: "proj-1", workspaceRoot: "/workspace" }],
    threads,
  });
}

function makeOrchestrationLayer(input: {
  readonly active?: OrchestrationV2ShellSnapshot;
  readonly archived?: OrchestrationV2ShellSnapshot;
  readonly projection?: OrchestrationV2ThreadProjection;
  readonly onDispatch?: (command: OrchestrationV2Command) => void;
}) {
  return Layer.succeed(
    T3Orchestration,
    fromPartial<Orchestration>({
      getShellSnapshot: () => Effect.succeed(input.active ?? makeSnapshot([])),
      getArchivedShellSnapshot: () => Effect.succeed(input.archived ?? makeSnapshot([])),
      getThreadProjection: () => Effect.succeed(input.projection ?? fromPartial({ runs: [] })),
      dispatch: (command: OrchestrationV2Command) => {
        input.onDispatch?.(command);
        return Effect.succeed({ sequence: 42 });
      },
    }),
  );
}

const testLayer = (orchestration: Layer.Layer<T3Orchestration>) =>
  Layer.mergeAll(
    orchestration,
    NodeServices.layer,
    CliRuntime.layer,
    t3CliEnvConfigLayer("/tmp/t3cli-test"),
  );

describe("interruptThread", () => {
  it.layer(NodeServices.layer)("interruptThread", (t) => {
    t.effect("dispatches run.interrupt for the live run", () =>
      Effect.gen(function* () {
        let dispatched: OrchestrationV2Command | undefined;
        const projection = fromPartial<OrchestrationV2ThreadProjection>({
          runs: [
            { id: "run-1", status: "completed" },
            { id: "run-2", status: "running" },
            { id: "run-3", status: "queued" },
          ],
        });
        const app = yield* makeThreadApplication().pipe(
          Effect.provide(
            testLayer(
              makeOrchestrationLayer({
                projection,
                onDispatch: (command) => {
                  dispatched = command;
                },
              }),
            ),
          ),
        );

        const dispatch = yield* app.interruptThread("thread-1");
        assert.equal(dispatch?.sequence, 42);
        assert.equal(dispatched?.type, "run.interrupt");
        if (dispatched?.type === "run.interrupt") {
          assert.equal(dispatched.threadId, "thread-1");
          assert.equal(dispatched.runId, "run-2");
        }
      }),
    );

    t.effect("does nothing when no run is live", () =>
      Effect.gen(function* () {
        let dispatched: OrchestrationV2Command | undefined;
        const projection = fromPartial<OrchestrationV2ThreadProjection>({
          runs: [{ id: "run-1", status: "completed" }],
        });
        const app = yield* makeThreadApplication().pipe(
          Effect.provide(
            testLayer(
              makeOrchestrationLayer({
                projection,
                onDispatch: (command) => {
                  dispatched = command;
                },
              }),
            ),
          ),
        );

        assert.isUndefined(yield* app.interruptThread("thread-1"));
        assert.isUndefined(dispatched);
      }),
    );
  });
});

describe("listThreads", () => {
  it.layer(NodeServices.layer)("listThreads", (t) => {
    t.effect("returns active threads by default", () =>
      Effect.gen(function* () {
        const active = makeSnapshot([
          makeThread("active-1", "proj-1", null),
          makeThread("active-2", "proj-1", null),
        ]);
        const archived = makeSnapshot([
          makeThread("archived-1", "proj-1", "2026-01-01T00:00:00.000Z"),
        ]);
        const app = yield* makeThreadApplication().pipe(
          Effect.provide(testLayer(makeOrchestrationLayer({ active, archived }))),
        );

        const result = yield* app.listThreads("proj-1");
        assert.deepEqual(
          result.threads.map((thread) => thread.id),
          ["active-1", "active-2"],
        );
      }),
    );

    t.effect("returns archived threads when include is archived", () =>
      Effect.gen(function* () {
        const active = makeSnapshot([makeThread("active-1", "proj-1", null)]);
        const archived = makeSnapshot([
          makeThread("archived-1", "proj-1", "2026-01-01T00:00:00.000Z"),
          makeThread("archived-2", "proj-1", "2026-01-02T00:00:00.000Z"),
        ]);
        const app = yield* makeThreadApplication().pipe(
          Effect.provide(testLayer(makeOrchestrationLayer({ active, archived }))),
        );

        const result = yield* app.listThreads("proj-1", { include: "archived" });
        assert.deepEqual(
          result.threads.map((thread) => thread.id),
          ["archived-1", "archived-2"],
        );
        assert.isTrue(result.threads.every((thread) => thread.archivedAt !== null));
      }),
    );

    t.effect("returns merged threads without duplicates when include is all", () =>
      Effect.gen(function* () {
        const active = makeSnapshot([
          makeThread("active-1", "proj-1", null),
          makeThread("shared", "proj-1", null),
        ]);
        const archived = makeSnapshot([
          makeThread("archived-1", "proj-1", "2026-01-01T00:00:00.000Z"),
          makeThread("shared", "proj-1", "2026-01-02T00:00:00.000Z"),
        ]);
        const app = yield* makeThreadApplication().pipe(
          Effect.provide(testLayer(makeOrchestrationLayer({ active, archived }))),
        );

        const result = yield* app.listThreads("proj-1", { include: "all" });
        assert.deepEqual(
          result.threads.map((thread) => thread.id).toSorted(),
          ["active-1", "archived-1", "shared"].toSorted(),
        );
        const shared = result.threads.find((thread) => thread.id === "shared");
        assert.equal(
          shared?.archivedAt == null ? null : DateTime.formatIso(shared.archivedAt),
          "2026-01-02T00:00:00.000Z",
        );
      }),
    );
  });
});
