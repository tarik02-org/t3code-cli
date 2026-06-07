import * as Schema from "effect/Schema";

export class T3CodeConnectionError extends Schema.TaggedErrorClass<T3CodeConnectionError>()(
  "T3CodeConnectionError",
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Unknown),
  },
) {}
