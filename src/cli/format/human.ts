import { Marked } from "marked";
import { markedTerminal } from "marked-terminal";
import stringWidth from "string-width";
import wrapAnsi from "wrap-ansi";

type TableColumn<Row> = {
  readonly header: string;
  readonly value: (row: Row) => string;
  readonly maxWidth?: number;
};

type RecordEntry = {
  readonly field: string;
  readonly value: string;
};

const terminalMarkdown = new Marked(
  markedTerminal({
    reflowText: false,
    showSectionPrefix: true,
    width: 100,
  }),
);

export function formatTable<Row>(
  columns: ReadonlyArray<TableColumn<Row>>,
  rows: ReadonlyArray<Row>,
) {
  if (rows.length === 0) {
    return "";
  }

  const widths = columns.map((column) =>
    Math.min(
      column.maxWidth ?? Number.POSITIVE_INFINITY,
      Math.max(stringWidth(column.header), ...rows.map((row) => widestLine(column.value(row)))),
    ),
  );

  const header = formatTableLine(
    columns.map((column) => column.header),
    widths,
  );
  const divider = widths.map((width) => "-".repeat(width)).join("  ");
  const body = rows.map((row) =>
    formatTableRow(
      columns.map((column) => column.value(row)),
      widths,
    ),
  );

  return [header, divider, ...body].join("\n");
}

export function formatRecord(entries: ReadonlyArray<RecordEntry>) {
  return formatTable(
    [
      { header: "field", value: (entry) => entry.field, maxWidth: 24 },
      { header: "value", value: (entry) => entry.value, maxWidth: 96 },
    ],
    entries,
  );
}

export function formatMarkdown(text: string) {
  return terminalMarkdown
    .parse(text, {
      async: false,
    })
    .trimEnd();
}

export function formatChatTranscript(
  messages: ReadonlyArray<{
    readonly role: string;
    readonly text: string;
  }>,
) {
  return `${messages.map(formatChatMessage).join("\n\n")}\n`;
}

function formatChatMessage(message: { readonly role: string; readonly text: string }) {
  const rendered = formatMarkdown(message.text);
  return `${message.role}\n${indentBlock(rendered.length > 0 ? rendered : "(empty)")}`;
}

function formatTableRow(cells: ReadonlyArray<string>, widths: ReadonlyArray<number>) {
  const wrappedCells = cells.map((cell, index) => wrapCell(cell, widths[index]!));
  const height = Math.max(...wrappedCells.map((cell) => cell.length));
  const lines: string[] = [];

  for (let rowIndex = 0; rowIndex < height; rowIndex += 1) {
    lines.push(
      formatTableLine(
        wrappedCells.map((cell) => cell[rowIndex] ?? ""),
        widths,
      ),
    );
  }

  return lines.join("\n");
}

function formatTableLine(cells: ReadonlyArray<string>, widths: ReadonlyArray<number>) {
  return cells.map((cell, index) => padRight(cell, widths[index]!)).join("  ");
}

function wrapCell(value: string, width: number) {
  const lines = value
    .split("\n")
    .flatMap((line) =>
      wrapAnsi(line.length > 0 ? line : " ", width, { hard: true, trim: false }).split("\n"),
    );
  return lines.length > 0 ? lines : [""];
}

function widestLine(value: string) {
  return Math.max(...value.split("\n").map((line) => stringWidth(line)));
}

function padRight(value: string, width: number) {
  const padding = width - stringWidth(value);
  return padding > 0 ? `${value}${" ".repeat(padding)}` : value;
}

function indentBlock(value: string) {
  return value
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}
