import * as Schema from "effect/Schema";

export class ProjectLookupError extends Schema.TaggedError<ProjectLookupError>()(
  "ProjectLookupError",
  {
    message: Schema.String,
    ref: Schema.String,
  },
) {}

export class ModelSelectionError extends Schema.TaggedError<ModelSelectionError>()(
  "ModelSelectionError",
  {
    message: Schema.String,
  },
) {}

export class ThreadEventError extends Schema.TaggedError<ThreadEventError>()("ThreadEventError", {
  message: Schema.String,
}) {}

export class ThreadSessionError extends Schema.TaggedError<ThreadSessionError>()(
  "ThreadSessionError",
  {
    message: Schema.String,
    threadId: Schema.String,
  },
) {}

export class ThreadLookupError extends Schema.TaggedError<ThreadLookupError>()(
  "ThreadLookupError",
  {
    message: Schema.String,
    threadId: Schema.String,
  },
) {}

export class QueuedRunError extends Schema.TaggedError<QueuedRunError>()("QueuedRunError", {
  message: Schema.String,
  threadId: Schema.String,
  runId: Schema.String,
}) {}

export class TerminalLookupError extends Schema.TaggedError<TerminalLookupError>()(
  "TerminalLookupError",
  {
    message: Schema.String,
    threadId: Schema.String,
    terminalId: Schema.String,
  },
) {}

export class ProjectActionLookupError extends Schema.TaggedError<ProjectActionLookupError>()(
  "ProjectActionLookupError",
  {
    message: Schema.String,
    projectId: Schema.String,
    selector: Schema.String,
  },
) {}

export class ProjectActionValidationError extends Schema.TaggedError<ProjectActionValidationError>()(
  "ProjectActionValidationError",
  {
    message: Schema.String,
    projectId: Schema.String,
  },
) {}

export class ThreadWorktreeError extends Schema.TaggedError<ThreadWorktreeError>()(
  "ThreadWorktreeError",
  {
    message: Schema.String,
    threadId: Schema.String,
  },
) {}

export type DomainError =
  | ProjectLookupError
  | ModelSelectionError
  | ThreadEventError
  | ThreadSessionError
  | ThreadLookupError
  | ThreadWorktreeError
  | QueuedRunError
  | TerminalLookupError
  | ProjectActionLookupError
  | ProjectActionValidationError;
