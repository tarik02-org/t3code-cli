import type {
  OrchestrationProjectShell,
  ProjectScript,
  TerminalSessionSnapshot,
} from "@t3tools/contracts";

import { formatRecord, formatTable } from "./format/human.ts";

type ActionRow = {
  readonly name: string;
  readonly id: string;
  readonly command: string;
  readonly icon: string;
  readonly setup: string;
  readonly preview: string;
};

export function formatActionListHuman(input: {
  readonly project: OrchestrationProjectShell;
  readonly actions: ReadonlyArray<ProjectScript>;
}) {
  if (input.actions.length === 0) {
    return `no actions for ${input.project.title} (${input.project.id})\n`;
  }
  return `${formatActionTable(input.actions.map(toActionRow))}\n`;
}

export function formatActionAddedHuman(input: {
  readonly project: OrchestrationProjectShell;
  readonly action: ProjectScript;
  readonly sequence: number;
}) {
  return `action added\n${formatActionRecord(input)}`;
}

export function formatActionUpdatedHuman(input: {
  readonly project: OrchestrationProjectShell;
  readonly action: ProjectScript;
  readonly sequence: number;
}) {
  return `action updated\n${formatActionRecord(input)}`;
}

export function formatActionDeletedHuman(input: {
  readonly project: OrchestrationProjectShell;
  readonly action: ProjectScript;
  readonly sequence: number;
}) {
  return `action deleted\n${formatActionRecord(input)}`;
}

export function formatActionRunHuman(input: {
  readonly project: OrchestrationProjectShell;
  readonly action: ProjectScript;
  readonly terminal: TerminalSessionSnapshot;
}) {
  return `action running\n${formatRecord([
    { field: "name", value: input.action.name },
    { field: "id", value: input.action.id },
    { field: "project", value: input.project.id },
    { field: "terminal", value: input.terminal.terminalId },
    { field: "cwd", value: input.terminal.cwd },
  ])}`;
}

function formatActionTable(rows: ReadonlyArray<ActionRow>) {
  return formatTable(
    [
      { header: "name", value: (row) => row.name, maxWidth: 28 },
      { header: "id", value: (row) => row.id, maxWidth: 24 },
      { header: "command", value: (row) => row.command, maxWidth: 48 },
      { header: "icon", value: (row) => row.icon, maxWidth: 10 },
      { header: "setup", value: (row) => row.setup, maxWidth: 5 },
      { header: "preview", value: (row) => row.preview, maxWidth: 48 },
    ],
    rows,
  );
}

function formatActionRecord(input: {
  readonly project: OrchestrationProjectShell;
  readonly action: ProjectScript;
  readonly sequence: number;
}) {
  return formatRecord([
    { field: "name", value: input.action.name },
    { field: "id", value: input.action.id },
    { field: "project", value: input.project.id },
    { field: "sequence", value: String(input.sequence) },
  ]);
}

function toActionRow(action: ProjectScript): ActionRow {
  return {
    name: action.name,
    id: action.id,
    command: action.command,
    icon: action.icon,
    setup: action.runOnWorktreeCreate ? "yes" : "no",
    preview: formatActionPreview(action),
  };
}

function formatActionPreview(action: ProjectScript) {
  const parts = [
    action.previewUrl ?? null,
    action.autoOpenPreview === true ? "auto open" : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join("\n") : "-";
}
