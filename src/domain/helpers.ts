import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import type { OrchestrationProjectShell, OrchestrationShellSnapshot } from "#t3tools/contracts";

export type ResolvedProjectScope = {
  readonly project: OrchestrationProjectShell;
  readonly inferredWorktreePath?: string;
};

export const resolveProjectScope = Effect.fn("resolveProjectScope")(function* (
  snapshot: OrchestrationShellSnapshot,
  input: {
    readonly ref: string;
    readonly cwd: string;
  },
) {
  const absoluteRef = yield* resolveAbsolutePath(input.ref, input.cwd);

  const byId = findProjectById(snapshot, input.ref);
  if (byId !== null) {
    return { project: byId };
  }

  const byExactPath = yield* findProjectByWorkspaceRoot(snapshot, absoluteRef, input.cwd);
  if (byExactPath !== undefined) {
    return { project: byExactPath };
  }

  const byAncestor = yield* findProjectByAncestorPath(snapshot, absoluteRef, input.cwd);
  if (byAncestor !== undefined) {
    return byAncestor;
  }

  return yield* findProjectByKnownWorktreePath(snapshot, absoluteRef, input.cwd);
});

export function findProjectById(
  snapshot: OrchestrationShellSnapshot,
  projectId: string,
): OrchestrationProjectShell | null {
  return snapshot.projects.find((project) => project.id === projectId) ?? null;
}

const resolveAbsolutePath = Effect.fn("resolveAbsolutePath")(function* (ref: string, cwd: string) {
  const path = yield* Path.Path;
  return path.isAbsolute(ref) ? path.normalize(ref) : path.normalize(path.resolve(cwd, ref));
});

const isDescendantPath = Effect.fn("isDescendantPath")(function* (parent: string, child: string) {
  const path = yield* Path.Path;
  if (child === parent) {
    return true;
  }
  const relative = path.relative(parent, child);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
});

const findProjectByWorkspaceRoot = Effect.fn("findProjectByWorkspaceRoot")(function* (
  snapshot: OrchestrationShellSnapshot,
  absolutePath: string,
  cwd: string,
) {
  for (const project of snapshot.projects) {
    const workspaceRoot = yield* resolveAbsolutePath(project.workspaceRoot, cwd);
    if (workspaceRoot === absolutePath) {
      return project;
    }
  }
  return undefined;
});

const findProjectByAncestorPath = Effect.fn("findProjectByAncestorPath")(function* (
  snapshot: OrchestrationShellSnapshot,
  absolutePath: string,
  cwd: string,
) {
  let bestProject: OrchestrationProjectShell | undefined;
  let bestWorkspaceRoot = "";

  for (const project of snapshot.projects) {
    const workspaceRoot = yield* resolveAbsolutePath(project.workspaceRoot, cwd);
    if (!(yield* isDescendantPath(workspaceRoot, absolutePath))) {
      continue;
    }
    if (workspaceRoot.length > bestWorkspaceRoot.length) {
      bestProject = project;
      bestWorkspaceRoot = workspaceRoot;
    }
  }

  if (bestProject === undefined) {
    return undefined;
  }

  if (absolutePath === bestWorkspaceRoot) {
    return { project: bestProject };
  }

  return {
    project: bestProject,
    inferredWorktreePath: absolutePath,
  };
});

const findProjectByKnownWorktreePath = Effect.fn("findProjectByKnownWorktreePath")(function* (
  snapshot: OrchestrationShellSnapshot,
  absolutePath: string,
  cwd: string,
) {
  const projectsById = new Map(snapshot.projects.map((project) => [project.id, project]));
  let bestProject: OrchestrationProjectShell | undefined;
  let bestKnownPath = "";

  for (const thread of snapshot.threads) {
    if (thread.worktreePath === null) {
      continue;
    }
    const project = projectsById.get(thread.projectId);
    if (project === undefined) {
      continue;
    }
    const knownPath = yield* resolveAbsolutePath(thread.worktreePath, cwd);
    if (!(yield* isDescendantPath(knownPath, absolutePath))) {
      continue;
    }
    if (knownPath.length > bestKnownPath.length) {
      bestProject = project;
      bestKnownPath = knownPath;
    }
  }

  if (bestProject === undefined) {
    return undefined;
  }

  const workspaceRoot = yield* resolveAbsolutePath(bestProject.workspaceRoot, cwd);
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
});
