import * as Schema from "effect/Schema";

export class TerminalCliError extends Schema.TaggedErrorClass<TerminalCliError>()(
  "TerminalCliError",
  {
    message: Schema.String,
    threadId: Schema.optionalKey(Schema.String),
    terminalId: Schema.optionalKey(Schema.String),
  },
) {}

export class TerminalIoError extends Schema.TaggedErrorClass<TerminalIoError>()("TerminalIoError", {
  message: Schema.String,
}) {}
