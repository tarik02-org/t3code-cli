import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { CliRuntime } from "../cli/runtime/service.ts";
import { T3Orchestration } from "../orchestration/service.ts";
import {
  ProjectCreateVisibilityError,
  ProjectLookupError,
  ProjectUpdateValidationError,
} from "../domain/error.ts";
import { findProjectById, resolveProjectScope } from "../domain/helpers.ts";
import {
  makeProjectCreateCommand,
  makeProjectDeleteCommand,
  makeProjectMetaUpdateCommand,
} from "./project-commands.ts";
import { resolveModelSelection } from "./model-selection.ts";
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
  const updateProject: T3ProjectApplicationService["updateProject"] = Effect.fn(
    "T3ApplicationLive.updateProject",
  )(function* (input) {
    const project = yield* resolveProject(input.projectRef);
    let workspaceRoot = input.workspaceRoot;
    if (workspaceRoot !== undefined) {
      if (!input.local && !path.isAbsolute(workspaceRoot)) {
        return yield* Effect.fail(
          new ProjectUpdateValidationError({
            message: "--workspace-root must be absolute for a remote environment",
            projectId: project.id,
          }),
        );
      }
      workspaceRoot = input.local
        ? path.resolve(cliRuntime.cwd, workspaceRoot)
        : path.normalize(workspaceRoot);
    }
    if (input.favicon !== undefined && input.favicon !== null) {
      const supported = /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(input.favicon);
      if (
        path.isAbsolute(input.favicon) ||
        input.favicon.split(/[\\/]/).includes("..") ||
        !supported
      ) {
        return yield* Effect.fail(
          new ProjectUpdateValidationError({
            message: "--favicon must be a workspace-relative supported image path",
            projectId: project.id,
          }),
        );
      }
    }
    let defaultModelSelection = input.defaultModelSelection;
    if (input.provider !== undefined || input.model !== undefined || input.options !== undefined) {
      defaultModelSelection = yield* resolveModelSelection({
        start: {
          message: "",
          ...(input.provider !== undefined ? { provider: input.provider } : {}),
          ...(input.model !== undefined ? { model: input.model } : {}),
          ...(input.options !== undefined ? { options: input.options } : {}),
        },
        project,
        serverConfig: yield* orchestration.getServerConfig(),
      });
    }
    const command = yield* makeProjectMetaUpdateCommand({
      projectId: project.id,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(workspaceRoot !== undefined ? { workspaceRoot } : {}),
      ...(defaultModelSelection !== undefined ? { defaultModelSelection } : {}),
      ...(input.defaultThreadEnvironment !== undefined
        ? { defaultThreadEnvironment: input.defaultThreadEnvironment }
        : {}),
      ...(input.favicon !== undefined ? { favicon: input.favicon } : {}),
    }).pipe(Effect.provideService(Crypto.Crypto, crypto));
    const dispatch = yield* orchestration.dispatch(command);
    const snapshot = yield* waitForShellSequence({ sequence: dispatch.sequence }).pipe(
      Effect.provideService(T3Orchestration, orchestration),
    );
    const updated = findProjectById(snapshot, project.id);
    if (updated === null) {
      return yield* Effect.fail(
        new ProjectLookupError({
          message: `project not found after update: ${project.id}`,
          ref: project.id,
        }),
      );
    }
    return { dispatch, project: updated };
  });

  return {
    loadShell,
    addProject,
    resolveProject,
    updateProject,
    deleteProject,
  } satisfies T3ProjectApplicationService;
});
