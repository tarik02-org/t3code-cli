import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import { CommandId, ProjectId, type ClientOrchestrationCommand } from "#t3tools/contracts";

export const makeProjectCreateCommand = Effect.fn("makeProjectCreateCommand")(function* (input: {
  readonly path: string;
  readonly title?: string;
  readonly cwd: string;
}) {
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const workspaceRoot = path.resolve(input.cwd, input.path);
  const projectId = ProjectId.make(yield* crypto.randomUUIDv4.pipe(Effect.orDie));
  const title = input.title?.trim();
  const createdAt = DateTime.formatIso(yield* DateTime.now);
  return {
    type: "project.create",
    commandId: CommandId.make(
      `t3cli:project-create:${yield* crypto.randomUUIDv4.pipe(Effect.orDie)}`,
    ),
    projectId,
    title: title !== undefined && title.length > 0 ? title : path.basename(workspaceRoot),
    workspaceRoot,
    createdAt,
  } satisfies Extract<ClientOrchestrationCommand, { readonly type: "project.create" }>;
});

export const makeProjectDeleteCommand = Effect.fn("makeProjectDeleteCommand")(function* (input: {
  readonly projectId: string;
  readonly force?: boolean;
}) {
  const crypto = yield* Crypto.Crypto;
  return {
    type: "project.delete",
    commandId: CommandId.make(
      `t3cli:project-delete:${yield* crypto.randomUUIDv4.pipe(Effect.orDie)}`,
    ),
    projectId: ProjectId.make(input.projectId),
    ...(input.force === true ? { force: true } : {}),
  } satisfies Extract<ClientOrchestrationCommand, { readonly type: "project.delete" }>;
});

export const makeProjectMetaUpdateCommand = Effect.fn("makeProjectMetaUpdateCommand")(
  function* (input: {
    readonly projectId: string;
    readonly scripts: Extract<
      ClientOrchestrationCommand,
      { readonly type: "project.meta.update" }
    >["scripts"];
  }) {
    const crypto = yield* Crypto.Crypto;
    return {
      type: "project.meta.update",
      commandId: CommandId.make(
        `t3cli:project-meta-update:${yield* crypto.randomUUIDv4.pipe(Effect.orDie)}`,
      ),
      projectId: ProjectId.make(input.projectId),
      scripts: input.scripts,
    } satisfies Extract<ClientOrchestrationCommand, { readonly type: "project.meta.update" }>;
  },
);
