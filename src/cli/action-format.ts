import type {
  OrchestrationProjectShell,
  ProjectScript,
  TerminalSessionSnapshot,
} from "#t3tools/contracts";

export function formatActionListHuman(input: {
  readonly project: OrchestrationProjectShell;
  readonly actions: ReadonlyArray<ProjectScript>;
}) {
  if (input.actions.length === 0) {
    return `no actions for ${input.project.title} (${input.project.id})\n`;
  }
  return input.actions.map(formatActionSummary).join("");
}

export function formatActionAddedHuman(input: {
  readonly project: OrchestrationProjectShell;
  readonly action: ProjectScript;
  readonly sequence: number;
}) {
  return `action added: ${input.action.name}\nid: ${input.action.id}\nproject: ${input.project.id}\nsequence: ${input.sequence}`;
}

export function formatActionUpdatedHuman(input: {
  readonly project: OrchestrationProjectShell;
  readonly action: ProjectScript;
  readonly sequence: number;
}) {
  return `action updated: ${input.action.name}\nid: ${input.action.id}\nproject: ${input.project.id}\nsequence: ${input.sequence}`;
}

export function formatActionDeletedHuman(input: {
  readonly project: OrchestrationProjectShell;
  readonly action: ProjectScript;
  readonly sequence: number;
}) {
  return `action deleted: ${input.action.name}\nid: ${input.action.id}\nproject: ${input.project.id}\nsequence: ${input.sequence}`;
}

export function formatActionRunHuman(input: {
  readonly project: OrchestrationProjectShell;
  readonly action: ProjectScript;
  readonly terminal: TerminalSessionSnapshot;
}) {
  return `action running: ${input.action.name}\nid: ${input.action.id}\nproject: ${input.project.id}\nterminal: ${input.terminal.terminalId}`;
}

function formatActionSummary(action: ProjectScript) {
  const details = [
    `  id: ${action.id}`,
    `  command: ${action.command}`,
    `  icon: ${action.icon}`,
    `  setup: ${action.runOnWorktreeCreate ? "yes" : "no"}`,
    ...(action.previewUrl !== undefined ? [`  preview: ${action.previewUrl}`] : []),
    ...(action.autoOpenPreview === true ? ["  auto open preview: yes"] : []),
  ];
  return `- ${action.name}\n${details.join("\n")}\n`;
}
