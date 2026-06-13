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

export class MissingRequestError extends Schema.TaggedErrorClass<MissingRequestError>()(
  "MissingRequestError",
  {
    message: Schema.String,
  },
) {}

export class MissingUpdateFieldsError extends Schema.TaggedErrorClass<MissingUpdateFieldsError>()(
  "MissingUpdateFieldsError",
  {
    message: Schema.String,
  },
) {}

export class ConflictingUpdateFlagsError extends Schema.TaggedErrorClass<ConflictingUpdateFlagsError>()(
  "ConflictingUpdateFlagsError",
  {
    message: Schema.String,
  },
) {}
