import "vite-plus/test/config";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import type {
  ClientOrchestrationCommand,
  OrchestrationShellSnapshot,
  OrchestrationThread,
  OrchestrationThreadShell,
} from "@t3tools/contracts";

import * as CliRuntime from "../cli/runtime/service.ts";
import { t3CliEnvConfigLayer } from "../config/env/env.test-utils.ts";
import { T3Orchestration, type Orchestration } from "../orchestration/service.ts";
import { makeThreadApplication } from "./threads.ts";

function makeThread(
  id: string,
  projectId: string,
  archivedAt: string | null,
): OrchestrationThreadShell {
  return fromPartial({
    id,
    projectId,
    archivedAt,
    title: `thread-${id}`,
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
}

function makeSnapshot(threads: OrchestrationThreadShell[]): OrchestrationShellSnapshot {
  return fromPartial({
    projects: [{ id: "proj-1", workspaceRoot: "/workspace" }],
    threads,
  });
}

function makeOrchestrationLayer(input: {
  readonly active?: OrchestrationShellSnapshot;
  readonly archived?: OrchestrationShellSnapshot;
  readonly threadSnapshot?: OrchestrationThread;
  readonly onDispatch?: (command: ClientOrchestrationCommand) => void;
}) {
  return Layer.succeed(
    T3Orchestration,
    fromPartial<Orchestration>({
      getShellSnapshot: () => Effect.succeed(input.active ?? makeSnapshot([])),
      getArchivedShellSnapshot: () => Effect.succeed(input.archived ?? makeSnapshot([])),
      getThreadSnapshot: () => Effect.succeed(input.threadSnapshot ?? fromPartial({})),
      dispatch: (command: ClientOrchestrationCommand) => {
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
    t.effect("dispatches thread.turn.interrupt with activeTurnId from snapshot", () =>
      Effect.gen(function* () {
        let dispatched: ClientOrchestrationCommand | undefined;
        const threadSnapshot = fromPartial<OrchestrationThread>({
          id: "thread-1",
          session: {
            activeTurnId: "turn-1",
          },
        });
        const app = yield* makeThreadApplication().pipe(
          Effect.provide(
            testLayer(
              makeOrchestrationLayer({
                threadSnapshot,
                onDispatch: (command) => {
                  dispatched = command;
                },
              }),
            ),
          ),
        );

        const dispatch = yield* app.interruptThread("thread-1");
        assert.equal(dispatch.sequence, 42);
        assert.equal(dispatched?.type, "thread.turn.interrupt");
        if (dispatched?.type === "thread.turn.interrupt") {
          assert.equal(dispatched.threadId, "thread-1");
          assert.equal(dispatched.turnId, "turn-1");
        }
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
        assert.equal(shared?.archivedAt, "2026-01-02T00:00:00.000Z");
      }),
    );
  });
});
