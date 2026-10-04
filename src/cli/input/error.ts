import * as Schema from "effect/Schema";

const PlatformErrorCauseSchema = Schema.Struct({
  _tag: Schema.Literal("PlatformError"),
  message: Schema.String,
});

export class InputError extends Schema.TaggedError<InputError>()("InputError", {
  message: Schema.String,
  cause: Schema.optionalKey(PlatformErrorCauseSchema),
}) {}
