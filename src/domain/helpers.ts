import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import type { OrchestrationProjectShell, OrchestrationShellSnapshot } from "@t3tools/contracts";

export type ResolvedProjectScope = {
  readonly project: OrchestrationProjectShell;
  readonly inferredWorktreePath?: string;
};

export const resolveProjectScope = Effect.fn("resolveProjectScope")(function* (
  snapshot: OrchestrationShellSnapshot,
  input: {
    readonly ref: string;
  },
) {
  const path = yield* Path.Path;

  const byId = findProjectById(snapshot, input.ref);
  if (byId !== null) {
    return { project: byId };
  }

  if (!path.isAbsolute(input.ref)) {
    return undefined;
  }

  return yield* findProjectByPathPriority(snapshot, path.normalize(input.ref));
});

export function findProjectById(
  snapshot: OrchestrationShellSnapshot,
  projectId: string,
): OrchestrationProjectShell | null {
  return snapshot.projects.find((project) => project.id === projectId) ?? null;
}

const isDescendantPath = Effect.fn("isDescendantPath")(function* (parent: string, child: string) {
  const path = yield* Path.Path;
  if (child === parent) {
    return true;
  }
  const relative = path.relative(parent, child);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
});

const findProjectByPathPriority = Effect.fn("findProjectByPathPriority")(function* (
  snapshot: OrchestrationShellSnapshot,
  absolutePath: string,
) {
  const path = yield* Path.Path;
  const projectsById = new Map(snapshot.projects.map((project) => [project.id, project]));
  const workspaceRoots = new Map(
    snapshot.projects.map(
      (project) => [project.id, path.normalize(project.workspaceRoot)] as const,
    ),
  );
  const candidates: Array<{
    readonly project: OrchestrationProjectShell;
    readonly matchPath: string;
    readonly workspaceRoot: string;
    readonly source: "worktree" | "project";
  }> = [];

  for (const thread of snapshot.threads) {
    if (thread.worktreePath === null) {
      continue;
    }
    const project = projectsById.get(thread.projectId);
    if (project === undefined) {
      continue;
    }
    const workspaceRoot = workspaceRoots.get(thread.projectId);
    if (workspaceRoot === undefined) {
      continue;
    }
    const matchPath = path.normalize(thread.worktreePath);
    if (!(yield* isDescendantPath(matchPath, absolutePath))) {
      continue;
    }
    candidates.push({
      project,
      matchPath,
      workspaceRoot,
      source: "worktree",
    });
  }

  for (const project of snapshot.projects) {
    const workspaceRoot = workspaceRoots.get(project.id);
    if (workspaceRoot === undefined) {
      continue;
    }
    if (!(yield* isDescendantPath(workspaceRoot, absolutePath))) {
      continue;
    }
    candidates.push({
      project,
      matchPath: workspaceRoot,
      workspaceRoot,
      source: "project",
    });
  }

  if (candidates.length === 0) {
    return undefined;
  }

  candidates.sort((left, right) => {
    if (left.matchPath.length !== right.matchPath.length) {
      return right.matchPath.length - left.matchPath.length;
    }
    if (left.source === right.source) {
      return 0;
    }
    return left.source === "worktree" ? -1 : 1;
  });

  const best = candidates[0]!;
  if (absolutePath === best.matchPath) {
    if (best.source === "worktree" && best.matchPath !== best.workspaceRoot) {
      return { project: best.project, inferredWorktreePath: best.matchPath };
    }
    return { project: best.project };
  }

  return { project: best.project, inferredWorktreePath: absolutePath };
});
