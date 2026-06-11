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

export class MissingThreadError extends Schema.TaggedErrorClass<MissingThreadError>()(
  "MissingThreadError",
  {
    message: Schema.String,
  },
) {}

export class SelfArchiveError extends Schema.TaggedErrorClass<SelfArchiveError>()(
  "SelfArchiveError",
  {
    message: Schema.String,
    threadId: Schema.String,
  },
) {}
