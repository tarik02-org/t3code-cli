import type * as Path from "effect/Path";

import { ProjectLookupError } from "./error.ts";
import type { ProjectShell, ShellSnapshot } from "./schema.ts";

export function resolveProject(snapshot: ShellSnapshot, ref: string, path: Path.Path, cwd: string) {
  const byId = findProjectById(snapshot, ref);
  if (byId) return byId;
  const absolute = path.resolve(cwd, ref);
  const byPath = snapshot.projects.find(
    (project) => path.resolve(cwd, project.workspaceRoot) === absolute,
  );
  if (byPath) return byPath;
  throw new ProjectLookupError({ message: `project not found: ${ref}`, ref });
}

export function findProjectById(snapshot: ShellSnapshot, projectId: string): ProjectShell | null {
  return snapshot.projects.find((project) => project.id === projectId) ?? null;
}
