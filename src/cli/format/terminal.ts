import type { TerminalSessionSnapshot, TerminalSummary } from "@t3tools/contracts";

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
  const headers = {
    id: "id",
    status: "status",
    label: "label",
    cwd: "cwd",
    updated: "updated",
    process: "process",
  };

  const widths = {
    id: columnWidth(
      headers.id,
      rows.map((row) => row.id),
      44,
    ),
    status: columnWidth(
      headers.status,
      rows.map((row) => row.status),
      8,
    ),
    label: columnWidth(
      headers.label,
      rows.map((row) => row.label),
      24,
    ),
    cwd: columnWidth(
      headers.cwd,
      rows.map((row) => row.cwd),
      40,
    ),
    updated: columnWidth(
      headers.updated,
      rows.map((row) => row.updated),
      24,
    ),
    process: columnWidth(
      headers.process,
      rows.map((row) => row.process),
      20,
    ),
  };

  const header = [
    pad(headers.id, widths.id),
    pad(headers.status, widths.status),
    pad(headers.label, widths.label),
    pad(headers.cwd, widths.cwd),
    pad(headers.updated, widths.updated),
    pad(headers.process, widths.process),
  ].join("  ");

  const divider = [
    "-".repeat(widths.id),
    "-".repeat(widths.status),
    "-".repeat(widths.label),
    "-".repeat(widths.cwd),
    "-".repeat(widths.updated),
    "-".repeat(widths.process),
  ].join("  ");

  const body = rows
    .map((row) =>
      [
        pad(row.id, widths.id),
        pad(row.status, widths.status),
        pad(row.label, widths.label),
        pad(row.cwd, widths.cwd),
        pad(row.updated, widths.updated),
        pad(row.process, widths.process),
      ].join("  "),
    )
    .join("\n");

  return `${header}\n${divider}\n${body}`;
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

function columnWidth(header: string, values: ReadonlyArray<string>, maxWidth: number) {
  const widest = values.reduce((width, value) => Math.max(width, value.length), header.length);
  return Math.min(widest, maxWidth);
}

function pad(value: string, width: number) {
  return truncate(value, width).padEnd(width, " ");
}

function truncate(value: string, width: number) {
  if (value.length <= width) {
    return value;
  }
  if (width <= 3) {
    return value.slice(0, width);
  }
  return `${value.slice(0, width - 3)}...`;
}
