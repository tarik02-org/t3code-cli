import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import { CommandId, ProjectId, type ProjectMutation, type ProjectScript } from "@t3tools/contracts";

const makeCommandId = Effect.fn("makeProjectCommandId")(function* (kind: string) {
  const crypto = yield* Crypto.Crypto;
  return CommandId.make(`t3cli:${kind}:${yield* crypto.randomUUIDv4.pipe(Effect.orDie)}`);
});

export const makeProjectCreateMutation = Effect.fn("makeProjectCreateMutation")(function* (input: {
  readonly path: string;
  readonly title?: string;
  readonly cwd: string;
}) {
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const workspaceRoot = path.resolve(input.cwd, input.path);
  const title = input.title?.trim();
  return {
    type: "project.create",
    commandId: yield* makeCommandId("project-create"),
    projectId: ProjectId.make(yield* crypto.randomUUIDv4.pipe(Effect.orDie)),
    title: title !== undefined && title.length > 0 ? title : path.basename(workspaceRoot),
    workspaceRoot,
  } satisfies Extract<ProjectMutation, { readonly type: "project.create" }>;
});

export const makeProjectDeleteMutation = Effect.fn("makeProjectDeleteMutation")(function* (input: {
  readonly projectId: string;
  readonly force?: boolean;
}) {
  return {
    type: "project.delete",
    commandId: yield* makeCommandId("project-delete"),
    projectId: ProjectId.make(input.projectId),
    ...(input.force === true ? { force: true } : {}),
  } satisfies Extract<ProjectMutation, { readonly type: "project.delete" }>;
});

export const makeProjectScriptsUpdateMutation = Effect.fn("makeProjectScriptsUpdateMutation")(
  function* (input: {
    readonly projectId: string;
    readonly scripts: ReadonlyArray<ProjectScript>;
  }) {
    return {
      type: "project.update",
      commandId: yield* makeCommandId("project-update"),
      projectId: ProjectId.make(input.projectId),
      scripts: input.scripts,
    } satisfies Extract<ProjectMutation, { readonly type: "project.update" }>;
  },
);
