import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { Environment } from "../environment/service.ts";
import type { ProjectCreateCommand } from "../domain/command-schema.ts";

export const makeProjectCreateCommand = Effect.fn("makeProjectCreateCommand")(function* (input: {
  readonly path: string;
  readonly title?: string;
}) {
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const environment = yield* Environment;
  const workspaceRoot = path.resolve(environment.cwd, input.path);
  const projectId = yield* crypto.randomUUIDv4.pipe(Effect.orDie);
  const title = input.title?.trim();
  const createdAt = DateTime.formatIso(yield* DateTime.now);
  return {
    type: "project.create",
    commandId: `t3cli:project-create:${yield* crypto.randomUUIDv4.pipe(Effect.orDie)}`,
    projectId,
    title: title !== undefined && title.length > 0 ? title : path.basename(workspaceRoot),
    workspaceRoot,
    createdAt,
  } satisfies ProjectCreateCommand & { readonly projectId: string };
});
