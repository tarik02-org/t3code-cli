import type * as Path from "effect/Path";
import type { OrchestrationProjectShell, OrchestrationShellSnapshot } from "#t3tools/contracts";

import { ProjectLookupError } from "./error.ts";

export function resolveProject(
  snapshot: OrchestrationShellSnapshot,
  ref: string,
  path: Path.Path,
  cwd: string,
) {
  const byId = findProjectById(snapshot, ref);
  if (byId !== null) {
    return byId;
  }
  const absolute = path.resolve(cwd, ref);
  const byPath = snapshot.projects.find(
    (project) => path.resolve(cwd, project.workspaceRoot) === absolute,
  );
  if (byPath !== undefined) {
    return byPath;
  }
  throw new ProjectLookupError({ message: `project not found: ${ref}`, ref });
}

export function findProjectById(
  snapshot: OrchestrationShellSnapshot,
  projectId: string,
): OrchestrationProjectShell | null {
  return snapshot.projects.find((project) => project.id === projectId) ?? null;
}
