import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";

export class UrlError extends Schema.TaggedError<UrlError>()("UrlError", {
  message: Schema.String,
  protocol: Schema.optionalKey(Schema.String),
  cause: Schema.optionalKey(Schema.instanceOf(Cause.IllegalArgumentError)),
}) {}
