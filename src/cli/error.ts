import * as Schema from "effect/Schema";

export class MessageInputError extends Schema.TaggedErrorClass<MessageInputError>()(
  "MessageInputError",
  {
    message: Schema.String,
  },
) {}

export class InvalidLimitError extends Schema.TaggedErrorClass<InvalidLimitError>()(
  "InvalidLimitError",
  {
    message: Schema.String,
    value: Schema.String,
  },
) {}
