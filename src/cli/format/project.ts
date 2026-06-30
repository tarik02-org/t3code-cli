import type { OrchestrationProjectShell } from "@t3tools/contracts";

import { formatRecord, formatTable } from "./human.ts";

export function formatProjectsHuman(projects: ReadonlyArray<OrchestrationProjectShell>) {
  if (projects.length === 0) {
    return "no projects\n";
  }
  return `${formatTable(
    [
      { header: "title", value: (project) => project.title, maxWidth: 32 },
      { header: "id", value: (project) => project.id, maxWidth: 40 },
      { header: "path", value: (project) => project.workspaceRoot, maxWidth: 72 },
    ],
    projects,
  )}\n`;
}

export function formatProjectAddedHuman(project: OrchestrationProjectShell) {
  return `project added\n${formatRecord([
    { field: "title", value: project.title },
    { field: "id", value: project.id },
    { field: "path", value: project.workspaceRoot },
  ])}`;
}

export function formatProjectDeletedHuman(input: {
  readonly projectId: string;
  readonly dispatch: { readonly sequence: number };
}) {
  return `project deleted: ${input.projectId} (sequence ${input.dispatch.sequence})`;
}
