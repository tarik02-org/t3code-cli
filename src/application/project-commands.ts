import type * as Path from "effect/Path";

import type { ProjectCreateCommand } from "../domain/command-schema.ts";

export function makeProjectCreateCommand(
  input: {
    readonly path: string;
    readonly title?: string;
  },
  path: Path.Path,
  cwd: string,
) {
  const workspaceRoot = path.resolve(cwd, input.path);
  const projectId = crypto.randomUUID();
  const title = input.title?.trim();
  return {
    type: "project.create",
    commandId: `t3cli:project-create:${crypto.randomUUID()}`,
    projectId,
    title: title !== undefined && title.length > 0 ? title : path.basename(workspaceRoot),
    workspaceRoot,
    createdAt: new Date().toISOString(),
  } satisfies ProjectCreateCommand & { readonly projectId: string };
}
