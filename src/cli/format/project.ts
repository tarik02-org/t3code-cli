import type { OrchestrationProjectShell } from "@t3tools/contracts";

export function formatProjectsHuman(projects: ReadonlyArray<OrchestrationProjectShell>) {
  return projects
    .map((project) => `- ${project.title}\n  id: ${project.id}\n  path: ${project.workspaceRoot}\n`)
    .join("");
}

export function formatProjectAddedHuman(project: OrchestrationProjectShell) {
  return `project added: ${project.title}\nid: ${project.id}\npath: ${project.workspaceRoot}`;
}

export function formatProjectDeletedHuman(input: {
  readonly projectId: string;
  readonly dispatch: { readonly sequence: number };
}) {
  return `project deleted: ${input.projectId}\nsequence: ${input.dispatch.sequence}`;
}
