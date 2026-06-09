import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import type { OrchestrationProjectShell, OrchestrationShellSnapshot } from "#t3tools/contracts";

import { ProjectLookupError } from "./error.ts";

export type ResolvedProjectScope = {
  readonly project: OrchestrationProjectShell;
  readonly inferredWorktreePath?: string;
};

export const resolveProjectScope = Effect.fn("resolveProjectScope")(function* (
  snapshot: OrchestrationShellSnapshot,
  input: {
    readonly ref?: string | undefined;
    readonly cwd: string;
  },
) {
  const path = yield* Path.Path;
  const ref = input.ref ?? input.cwd;
  const absoluteRef = resolveAbsolutePath(path, ref, input.cwd);

  const byId = findProjectById(snapshot, ref);
  if (byId !== null) {
    return { project: byId };
  }

  const byExactPath = findProjectByWorkspaceRoot(snapshot, absoluteRef, path, input.cwd);
  if (byExactPath !== undefined) {
    return { project: byExactPath };
  }

  const byAncestor = findProjectByAncestorPath(snapshot, absoluteRef, path, input.cwd);
  if (byAncestor !== null) {
    return byAncestor;
  }

  const byKnownWorktree = findProjectByKnownWorktreePath(snapshot, absoluteRef, path, input.cwd);
  if (byKnownWorktree !== null) {
    return byKnownWorktree;
  }

  return yield* Effect.fail(new ProjectLookupError({ message: `project not found: ${ref}`, ref }));
});

export function findProjectById(
  snapshot: OrchestrationShellSnapshot,
  projectId: string,
): OrchestrationProjectShell | null {
  return snapshot.projects.find((project) => project.id === projectId) ?? null;
}

function resolveAbsolutePath(path: Path.Path, ref: string, cwd: string): string {
  return path.isAbsolute(ref) ? path.normalize(ref) : path.normalize(path.resolve(cwd, ref));
}

function findProjectByWorkspaceRoot(
  snapshot: OrchestrationShellSnapshot,
  absolutePath: string,
  path: Path.Path,
  cwd: string,
): OrchestrationProjectShell | undefined {
  return snapshot.projects.find((project) => {
    const workspaceRoot = resolveAbsolutePath(path, project.workspaceRoot, cwd);
    return workspaceRoot === absolutePath;
  });
}

function findProjectByAncestorPath(
  snapshot: OrchestrationShellSnapshot,
  absolutePath: string,
  path: Path.Path,
  cwd: string,
): ResolvedProjectScope | null {
  let bestProject: OrchestrationProjectShell | null = null;
  let bestWorkspaceRoot = "";

  for (const project of snapshot.projects) {
    const workspaceRoot = resolveAbsolutePath(path, project.workspaceRoot, cwd);
    if (!isDescendantPath(path, workspaceRoot, absolutePath)) {
      continue;
    }
    if (workspaceRoot.length > bestWorkspaceRoot.length) {
      bestProject = project;
      bestWorkspaceRoot = workspaceRoot;
    }
  }

  if (bestProject === null) {
    return null;
  }

  if (absolutePath === bestWorkspaceRoot) {
    return { project: bestProject };
  }

  return {
    project: bestProject,
    inferredWorktreePath: absolutePath,
  };
}

function findProjectByKnownWorktreePath(
  snapshot: OrchestrationShellSnapshot,
  absolutePath: string,
  path: Path.Path,
  cwd: string,
): ResolvedProjectScope | null {
  const projectsById = new Map(snapshot.projects.map((project) => [project.id, project]));
  let bestProject: OrchestrationProjectShell | null = null;
  let bestKnownPath = "";

  for (const thread of snapshot.threads) {
    if (thread.worktreePath === null) {
      continue;
    }
    const project = projectsById.get(thread.projectId);
    if (project === undefined) {
      continue;
    }
    const knownPath = resolveAbsolutePath(path, thread.worktreePath, cwd);
    if (!isDescendantPath(path, knownPath, absolutePath)) {
      continue;
    }
    if (knownPath.length > bestKnownPath.length) {
      bestProject = project;
      bestKnownPath = knownPath;
    }
  }

  if (bestProject === null) {
    return null;
  }

  const workspaceRoot = resolveAbsolutePath(path, bestProject.workspaceRoot, cwd);
  if (absolutePath === workspaceRoot) {
    return { project: bestProject };
  }

  if (absolutePath === bestKnownPath) {
    return bestKnownPath === workspaceRoot
      ? { project: bestProject }
      : { project: bestProject, inferredWorktreePath: bestKnownPath };
  }

  return {
    project: bestProject,
    inferredWorktreePath: absolutePath,
  };
}

function isDescendantPath(path: Path.Path, parent: string, child: string): boolean {
  if (child === parent) {
    return true;
  }
  const relative = path.relative(parent, child);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}
