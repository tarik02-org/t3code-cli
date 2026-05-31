import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { Environment } from "../environment/service.ts";
import { T3Orchestration } from "../orchestration/service.ts";
import { ProjectCreateVisibilityError } from "../domain/error.ts";
import { findProjectById } from "../domain/helpers.ts";
import { makeProjectCreateCommand } from "./project-commands.ts";
import { waitForShellSequence } from "./shell-sequence.ts";

export const makeProjectApplication = Effect.fn("makeProjectApplication")(function* () {
  const orchestration = yield* T3Orchestration;
  const crypto = yield* Crypto.Crypto;
  const path = yield* Path.Path;
  const environment = yield* Environment;
  const loadShell = Effect.fn("T3ApplicationLive.loadShell")(function* () {
    return yield* orchestration.getShellSnapshot();
  });
  const addProject = Effect.fn("T3ApplicationLive.addProject")(function* (projectInput: {
    readonly path: string;
    readonly title?: string;
  }) {
    const command = yield* makeProjectCreateCommand(projectInput).pipe(
      Effect.provideService(Path.Path, path),
      Effect.provideService(Crypto.Crypto, crypto),
      Effect.provideService(Environment, environment),
    );
    const dispatch = yield* orchestration.dispatch(command);
    const snapshot = yield* waitForShellSequence({
      orchestration,
      sequence: dispatch.sequence,
    });
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

  return {
    loadShell,
    addProject,
  };
});
