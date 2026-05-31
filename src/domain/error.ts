import * as Schema from "effect/Schema";

import type { OrchestrationError } from "../orchestration/error.ts";

export class MessageInputError extends Schema.TaggedErrorClass<MessageInputError>()(
  "MessageInputError",
  {
    message: Schema.String,
  },
) {}

export class ProjectLookupError extends Schema.TaggedErrorClass<ProjectLookupError>()(
  "ProjectLookupError",
  {
    message: Schema.String,
    ref: Schema.String,
  },
) {}

export class ModelSelectionError extends Schema.TaggedErrorClass<ModelSelectionError>()(
  "ModelSelectionError",
  {
    message: Schema.String,
  },
) {}

export class ThreadEventError extends Schema.TaggedErrorClass<ThreadEventError>()(
  "ThreadEventError",
  {
    message: Schema.String,
  },
) {}

export class ThreadSessionError extends Schema.TaggedErrorClass<ThreadSessionError>()(
  "ThreadSessionError",
  {
    message: Schema.String,
    threadId: Schema.String,
  },
) {}

export class InvalidLimitError extends Schema.TaggedErrorClass<InvalidLimitError>()(
  "InvalidLimitError",
  {
    message: Schema.String,
    value: Schema.String,
  },
) {}

export class ProjectCreateVisibilityError extends Schema.TaggedErrorClass<ProjectCreateVisibilityError>()(
  "ProjectCreateVisibilityError",
  {
    message: Schema.String,
    projectId: Schema.String,
  },
) {}

export type DomainError =
  | OrchestrationError
  | MessageInputError
  | ProjectLookupError
  | ModelSelectionError
  | ThreadEventError
  | ThreadSessionError
  | InvalidLimitError
  | ProjectCreateVisibilityError;
