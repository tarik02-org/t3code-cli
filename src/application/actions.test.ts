import "vite-plus/test/config";

import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import type {
  ClientOrchestrationCommand,
  OrchestrationProjectShell,
  OrchestrationShellSnapshot,
  ProjectScript,
} from "@t3tools/contracts";

import { ProjectActionLookupError, ProjectActionValidationError } from "../domain/error.ts";
import { T3Orchestration, type Orchestration } from "../orchestration/service.ts";
import { makeActionApplication, nextProjectScriptId } from "./actions.ts";
import { T3TerminalApplication, type CreateTerminalInput } from "./service.ts";

function makeProject(scripts: ReadonlyArray<ProjectScript>): OrchestrationProjectShell {
  return fromPartial({
    id: "proj-1",
    title: "Project",
    workspaceRoot: "/workspace",
    scripts,
  });
}

function makeSnapshot(project: OrchestrationProjectShell): OrchestrationShellSnapshot {
  return fromPartial({
    projects: [project],
    threads: [
      {
        id: "thread-1",
        projectId: project.id,
        worktreePath: "/workspace/.worktrees/thread-1",
      },
    ],
  });
}

function makeAction(overrides: Partial<ProjectScript>): ProjectScript {
  return {
    id: "test",
    name: "Test",
    command: "npm test",
    icon: "test",
    runOnWorktreeCreate: false,
    ...overrides,
  };
}

function makeTestLayer(input: {
  readonly project: OrchestrationProjectShell;
  readonly onDispatch?: (command: ClientOrchestrationCommand) => void;
  readonly onCreateTerminal?: (input: CreateTerminalInput) => void;
}) {
  let project = input.project;
  const orchestration = Layer.succeed(
    T3Orchestration,
    fromPartial<Orchestration>({
      getShellSnapshot: () => Effect.succeed(makeSnapshot(project)),
      watchShellSequence: () => Stream.make(42),
      dispatch: (command: ClientOrchestrationCommand) => {
        input.onDispatch?.(command);
        if (command.type === "project.meta.update" && command.scripts !== undefined) {
          project = { ...project, scripts: command.scripts };
        }
        return Effect.succeed({ sequence: 42 });
      },
    }),
  );
  const terminals = Layer.succeed(
    T3TerminalApplication,
    fromPartial({
      createTerminal: (terminalInput: CreateTerminalInput) => {
        input.onCreateTerminal?.(terminalInput);
        return Effect.succeed(
          fromPartial({
            threadId: terminalInput.threadId,
            terminalId: terminalInput.terminalId ?? "generated-terminal",
            cwd: "/workspace/.worktrees/thread-1",
            worktreePath: "/workspace/.worktrees/thread-1",
          }),
        );
      },
    }),
  );
  return Layer.mergeAll(orchestration, terminals, NodeServices.layer);
}

describe("project actions", () => {
  it("generates action ids like the frontend", () => {
    assert.equal(nextProjectScriptId("Run Tests", []), "run-tests");
    assert.equal(nextProjectScriptId("Run Tests", ["run-tests"]), "run-tests-2");
    assert.equal(nextProjectScriptId("!!!", []), "script");
  });

  it.layer(NodeServices.layer)("makeActionApplication", (t) => {
    t.effect("adds an action and clears existing setup actions", () =>
      Effect.gen(function* () {
        let dispatched: ClientOrchestrationCommand | undefined;
        const app = yield* makeActionApplication().pipe(
          Effect.provide(
            makeTestLayer({
              project: makeProject([
                makeAction({
                  id: "setup",
                  name: "Setup",
                  command: "npm install",
                  icon: "configure",
                  runOnWorktreeCreate: true,
                }),
              ]),
              onDispatch: (command) => {
                dispatched = command;
              },
            }),
          ),
        );

        const result = yield* app.addAction({
          projectRef: "proj-1",
          name: "Run Tests",
          command: "npm test",
          icon: "test",
          setup: true,
          previewUrl: " http://localhost:5173 ",
          autoOpenPreview: true,
        });

        assert.equal(result.action.id, "run-tests");
        assert.equal(result.action.previewUrl, "http://localhost:5173");
        assert.equal(result.action.autoOpenPreview, true);
        assert.equal(dispatched?.type, "project.meta.update");
        if (dispatched?.type === "project.meta.update") {
          assert.isDefined(dispatched.scripts);
          assert.deepEqual(
            dispatched.scripts.map((script) => [script.id, script.runOnWorktreeCreate]),
            [
              ["setup", false],
              ["run-tests", true],
            ],
          );
        }
      }),
    );

    t.effect("adds a non-setup action without changing the existing setup action", () =>
      Effect.gen(function* () {
        let dispatched: ClientOrchestrationCommand | undefined;
        const app = yield* makeActionApplication().pipe(
          Effect.provide(
            makeTestLayer({
              project: makeProject([
                makeAction({
                  id: "setup",
                  name: "Setup",
                  command: "npm install",
                  icon: "configure",
                  runOnWorktreeCreate: true,
                }),
              ]),
              onDispatch: (command) => {
                dispatched = command;
              },
            }),
          ),
        );

        const result = yield* app.addAction({
          projectRef: "proj-1",
          name: "Run Tests",
          command: "npm test",
          icon: "test",
        });

        assert.equal(result.action.runOnWorktreeCreate, false);
        assert.equal(dispatched?.type, "project.meta.update");
        if (dispatched?.type === "project.meta.update") {
          assert.isDefined(dispatched.scripts);
          assert.deepEqual(
            dispatched.scripts.map((script) => [script.id, script.runOnWorktreeCreate]),
            [
              ["setup", true],
              ["run-tests", false],
            ],
          );
        }
      }),
    );

    t.effect("rejects explicit ids that cannot be used as script run commands", () =>
      Effect.gen(function* () {
        const app = yield* makeActionApplication().pipe(
          Effect.provide(
            makeTestLayer({
              project: makeProject([]),
            }),
          ),
        );

        const exit = yield* app
          .addAction({
            projectRef: "proj-1",
            id: "Bad Id",
            name: "Run Tests",
            command: "npm test",
            icon: "test",
          })
          .pipe(Effect.exit);

        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) {
          const error = Cause.findErrorOption(exit.cause);
          assert.isTrue(Option.isSome(error));
          if (Option.isSome(error)) {
            assert.instanceOf(error.value, ProjectActionValidationError);
          }
        }
      }),
    );

    t.effect("updates by exact case-insensitive trimmed name and clears preview data", () =>
      Effect.gen(function* () {
        const app = yield* makeActionApplication().pipe(
          Effect.provide(
            makeTestLayer({
              project: makeProject([
                makeAction({
                  id: "dev",
                  name: "Dev",
                  command: "npm run dev",
                  icon: "play",
                  previewUrl: "http://localhost:5173",
                  autoOpenPreview: true,
                }),
              ]),
            }),
          ),
        );

        const result = yield* app.updateAction({
          projectRef: "proj-1",
          selector: { name: " dev " },
          command: "pnpm dev",
          previewUrl: null,
        });

        assert.equal(result.action.command, "pnpm dev");
        assert.equal(result.action.previewUrl, undefined);
        assert.equal(result.action.autoOpenPreview, undefined);
      }),
    );

    t.effect("fails clearly when name selector is ambiguous", () =>
      Effect.gen(function* () {
        const app = yield* makeActionApplication().pipe(
          Effect.provide(
            makeTestLayer({
              project: makeProject([
                makeAction({ id: "test-1", name: "Test" }),
                makeAction({ id: "test-2", name: " test " }),
              ]),
            }),
          ),
        );

        const exit = yield* app.listActions("proj-1").pipe(
          Effect.flatMap(() =>
            app.updateAction({
              projectRef: "proj-1",
              selector: { name: "TEST" },
              command: "npm test -- --watch",
            }),
          ),
          Effect.exit,
        );

        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) {
          const error = Cause.findErrorOption(exit.cause);
          assert.isTrue(Option.isSome(error));
          if (Option.isSome(error)) {
            assert.instanceOf(error.value, ProjectActionLookupError);
          }
        }
      }),
    );

    t.effect("runs an action in a thread terminal with project env", () =>
      Effect.gen(function* () {
        let created: CreateTerminalInput | undefined;
        const app = yield* makeActionApplication().pipe(
          Effect.provide(
            makeTestLayer({
              project: makeProject([makeAction({ id: "test", name: "Test" })]),
              onCreateTerminal: (input) => {
                created = input;
              },
            }),
          ),
        );

        const result = yield* app.runAction({
          threadId: "thread-1",
          selector: { id: "test" },
          terminalId: "term-1",
        });

        assert.equal(result.terminal.terminalId, "term-1");
        assert.deepEqual(created, {
          threadId: "thread-1",
          terminalId: "term-1",
          command: "npm test",
          env: {
            T3CODE_PROJECT_ROOT: "/workspace",
            T3CODE_WORKTREE_PATH: "/workspace/.worktrees/thread-1",
          },
        });
      }),
    );
  });
});
