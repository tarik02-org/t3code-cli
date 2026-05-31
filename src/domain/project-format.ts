import type { ProjectShell } from "./schema.ts";

export function formatProjectsHuman(projects: ReadonlyArray<ProjectShell>) {
  return projects
    .map((project) => `- ${project.title}\n  id: ${project.id}\n  path: ${project.workspaceRoot}\n`)
    .join("");
}

export function formatProjectAddedHuman(project: ProjectShell) {
  return `project added: ${project.title}\nid: ${project.id}\npath: ${project.workspaceRoot}`;
}
