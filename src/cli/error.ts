import * as Schema from "effect/Schema";

export class MessageInputError extends Schema.TaggedError<MessageInputError>()(
  "MessageInputError",
  {
    message: Schema.String,
  },
) {}

export class InvalidLimitError extends Schema.TaggedError<InvalidLimitError>()(
  "InvalidLimitError",
  {
    message: Schema.String,
    value: Schema.String,
  },
) {}

export class MissingThreadError extends Schema.TaggedError<MissingThreadError>()(
  "MissingThreadError",
  {
    message: Schema.String,
  },
) {}

export class SelfActionError extends Schema.TaggedError<SelfActionError>()("SelfActionError", {
  message: Schema.String,
  threadId: Schema.String,
}) {}

export class DestructiveConfirmationRequiredError extends Schema.TaggedError<DestructiveConfirmationRequiredError>()(
  "DestructiveConfirmationRequiredError",
  { message: Schema.String },
) {}

export class InvalidFlagCombinationError extends Schema.TaggedError<InvalidFlagCombinationError>()(
  "InvalidFlagCombinationError",
  {
    message: Schema.String,
  },
) {}

export class InvalidAskTimeoutError extends Schema.TaggedError<InvalidAskTimeoutError>()(
  "InvalidAskTimeoutError",
  {
    message: Schema.String,
    value: Schema.String,
  },
) {}

export class AskThreadArchivedError extends Schema.TaggedError<AskThreadArchivedError>()(
  "AskThreadArchivedError",
  {
    message: Schema.String,
    threadId: Schema.String,
  },
) {}

export class AskThreadBusyError extends Schema.TaggedError<AskThreadBusyError>()(
  "AskThreadBusyError",
  {
    message: Schema.String,
    threadId: Schema.String,
  },
) {}

export class AskThreadPendingRequestError extends Schema.TaggedError<AskThreadPendingRequestError>()(
  "AskThreadPendingRequestError",
  {
    message: Schema.String,
    threadId: Schema.String,
  },
) {}

export class AskProjectMismatchError extends Schema.TaggedError<AskProjectMismatchError>()(
  "AskProjectMismatchError",
  {
    message: Schema.String,
    threadId: Schema.String,
    projectId: Schema.String,
  },
) {}

export class AskNoAnswerError extends Schema.TaggedError<AskNoAnswerError>()("AskNoAnswerError", {
  message: Schema.String,
  threadId: Schema.String,
}) {}

export class AskTimeoutError extends Schema.TaggedError<AskTimeoutError>()("AskTimeoutError", {
  message: Schema.String,
  timeout: Schema.String,
}) {}

export class MissingRequestError extends Schema.TaggedError<MissingRequestError>()(
  "MissingRequestError",
  {
    message: Schema.String,
  },
) {}

export class MissingUpdateFieldsError extends Schema.TaggedError<MissingUpdateFieldsError>()(
  "MissingUpdateFieldsError",
  {
    message: Schema.String,
  },
) {}

export class ConflictingUpdateFlagsError extends Schema.TaggedError<ConflictingUpdateFlagsError>()(
  "ConflictingUpdateFlagsError",
  {
    message: Schema.String,
  },
) {}

export class InvalidSnoozeUntilError extends Schema.TaggedError<InvalidSnoozeUntilError>()(
  "InvalidSnoozeUntilError",
  {
    message: Schema.String,
    value: Schema.String,
  },
) {}

export class UnavailableSnoozePresetError extends Schema.TaggedError<UnavailableSnoozePresetError>()(
  "UnavailableSnoozePresetError",
  {
    message: Schema.String,
    preset: Schema.String,
  },
) {}
