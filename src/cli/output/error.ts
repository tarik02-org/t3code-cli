import * as Schema from "effect/Schema";

const PlatformErrorCauseSchema = Schema.Struct({
  _tag: Schema.Literal("PlatformError"),
  message: Schema.String,
});

export class OutputError extends Schema.TaggedError<OutputError>()("OutputError", {
  message: Schema.String,
  cause: Schema.optionalKey(PlatformErrorCauseSchema),
}) {}
