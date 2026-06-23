import type { TerminalSessionSnapshot, TerminalSummary } from "#t3tools/contracts";

import { formatTable } from "./human.ts";

type TerminalRow = {
  readonly id: string;
  readonly status: string;
  readonly label: string;
  readonly cwd: string;
  readonly updated: string;
  readonly process: string;
};

export function formatTerminalListHuman(terminals: ReadonlyArray<TerminalSummary>) {
  if (terminals.length === 0) {
    return "no terminals\n";
  }
  return `${formatTerminalTable(terminals.map(toSummaryRow))}\n`;
}

export function formatTerminalCreatedHuman(snapshot: TerminalSessionSnapshot) {
  return `terminal created\n${formatTerminalTable([toSnapshotRow(snapshot)])}`;
}

export function formatTerminalWrittenHuman(input: {
  readonly terminalId: string;
  readonly threadId: string;
  readonly bytes: number;
}) {
  return `wrote ${input.bytes} bytes to ${input.terminalId} (${input.threadId})`;
}

export function formatTerminalDestroyedHuman(input: {
  readonly terminalId: string;
  readonly threadId: string;
}) {
  return `destroyed ${input.terminalId} (${input.threadId})`;
}

function formatTerminalTable(rows: ReadonlyArray<TerminalRow>) {
  return formatTable(
    [
      { header: "id", value: (row) => row.id, maxWidth: 44 },
      { header: "status", value: (row) => row.status, maxWidth: 8 },
      { header: "label", value: (row) => row.label, maxWidth: 24 },
      { header: "cwd", value: (row) => row.cwd, maxWidth: 40 },
      { header: "updated", value: (row) => row.updated, maxWidth: 24 },
      { header: "process", value: (row) => row.process, maxWidth: 20 },
    ],
    rows,
  );
}

function toSummaryRow(terminal: TerminalSummary): TerminalRow {
  return {
    id: terminal.terminalId,
    status: terminal.status,
    label: terminal.label,
    cwd: terminal.cwd,
    updated: terminal.updatedAt,
    process: formatProcessInfo(terminal),
  };
}

function toSnapshotRow(snapshot: TerminalSessionSnapshot): TerminalRow {
  return {
    id: snapshot.terminalId,
    status: snapshot.status,
    label: snapshot.label,
    cwd: snapshot.cwd,
    updated: snapshot.updatedAt,
    process: formatProcessInfo(snapshot),
  };
}

function formatProcessInfo(input: {
  readonly pid: number | null;
  readonly exitCode: number | null;
  readonly exitSignal: number | null;
}) {
  const parts = [
    typeof input.pid === "number" ? `pid ${input.pid}` : null,
    typeof input.exitCode === "number" ? `exit ${input.exitCode}` : null,
    typeof input.exitSignal === "number" ? `sig ${input.exitSignal}` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(", ") : "-";
}
