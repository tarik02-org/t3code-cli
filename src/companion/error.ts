import * as Schema from "effect/Schema";

export class CompanionStoreError extends Schema.TaggedError<CompanionStoreError>()(
  "CompanionStoreError",
  {
    message: Schema.String,
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class CompanionUnknownEnvironmentError extends Schema.TaggedError<CompanionUnknownEnvironmentError>()(
  "CompanionUnknownEnvironmentError",
  {
    message: Schema.String,
    environment: Schema.String,
  },
) {}

export class CompanionEnvironmentError extends Schema.TaggedError<CompanionEnvironmentError>()(
  "CompanionEnvironmentError",
  {
    message: Schema.String,
    environment: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class CompanionInvalidRequestError extends Schema.TaggedError<CompanionInvalidRequestError>()(
  "CompanionInvalidRequestError",
  {
    message: Schema.String,
  },
) {}

export class CompanionNotRunningError extends Schema.TaggedError<CompanionNotRunningError>()(
  "CompanionNotRunningError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class CompanionClientError extends Schema.TaggedError<CompanionClientError>()(
  "CompanionClientError",
  {
    message: Schema.String,
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {}

/** What MCP callers see when a tool fails; the cause is logged by the daemon. */
export class CompanionToolError extends Schema.TaggedError<CompanionToolError>()(
  "CompanionToolError",
  {
    message: Schema.String,
    tool: Schema.String,
  },
) {}
