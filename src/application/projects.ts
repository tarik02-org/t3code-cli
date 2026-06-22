import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { CliRuntime } from "../cli/runtime/service.ts";
import { T3Orchestration } from "../orchestration/service.ts";
import { ProjectCreateVisibilityError, ProjectLookupError } from "../domain/error.ts";
import { findProjectById, resolveProjectScope } from "../domain/helpers.ts";
import { makeProjectCreateCommand, makeProjectDeleteCommand } from "./project-commands.ts";
import { waitForShellSequence } from "./shell-sequence.ts";
import type { T3ProjectApplicationService } from "./service.ts";

export const makeProjectApplication = Effect.fn("makeProjectApplication")(function* () {
  const orchestration = yield* T3Orchestration;
  const crypto = yield* Crypto.Crypto;
  const path = yield* Path.Path;
  const cliRuntime = yield* CliRuntime;
  const loadShell: T3ProjectApplicationService["loadShell"] = Effect.fn(
    "T3ApplicationLive.loadShell",
  )(function* () {
    return yield* orchestration.getShellSnapshot();
  });
  const resolveProject: T3ProjectApplicationService["resolveProject"] = Effect.fn(
    "T3ApplicationLive.resolveProject",
  )(function* (projectRef: string) {
    const snapshot = yield* orchestration.getShellSnapshot();
    const scope = yield* resolveProjectScope(snapshot, {
      ref: projectRef,
    }).pipe(Effect.provideService(Path.Path, path));
    if (scope === undefined) {
      return yield* Effect.fail(
        new ProjectLookupError({
          message: `project not found: ${projectRef}`,
          ref: projectRef,
        }),
      );
    }
    return scope.project;
  });
  const addProject: T3ProjectApplicationService["addProject"] = Effect.fn(
    "T3ApplicationLive.addProject",
  )(function* (projectInput: { readonly path: string; readonly title?: string }) {
    const command = yield* makeProjectCreateCommand({
      ...projectInput,
      cwd: cliRuntime.cwd,
    }).pipe(Effect.provideService(Path.Path, path), Effect.provideService(Crypto.Crypto, crypto));
    const dispatch = yield* orchestration.dispatch(command);
    const snapshot = yield* waitForShellSequence({ sequence: dispatch.sequence }).pipe(
      Effect.provideService(T3Orchestration, orchestration),
    );
    const project = findProjectById(snapshot, command.projectId);
    if (project === null) {
      return yield* Effect.fail(
        new ProjectCreateVisibilityError({
          message: `project created but not visible in shell snapshot: ${command.projectId}`,
          projectId: command.projectId,
        }),
      );
    }
    return { dispatch, project };
  });
  const deleteProject: T3ProjectApplicationService["deleteProject"] = Effect.fn(
    "T3ApplicationLive.deleteProject",
  )(function* (input: { readonly projectId: string; readonly force?: boolean }) {
    const command = yield* makeProjectDeleteCommand({
      projectId: input.projectId,
      ...(input.force === true ? { force: true } : {}),
    }).pipe(Effect.provideService(Crypto.Crypto, crypto));
    const dispatch = yield* orchestration.dispatch(command);
    return { projectId: input.projectId, dispatch };
  });

  return {
    loadShell,
    addProject,
    resolveProject,
    deleteProject,
  } satisfies T3ProjectApplicationService;
});
