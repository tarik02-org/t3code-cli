import * as Schema from "effect/Schema";

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

export class ThreadLookupError extends Schema.TaggedErrorClass<ThreadLookupError>()(
  "ThreadLookupError",
  {
    message: Schema.String,
    threadId: Schema.String,
  },
) {}

export class ProjectCreateVisibilityError extends Schema.TaggedErrorClass<ProjectCreateVisibilityError>()(
  "ProjectCreateVisibilityError",
  {
    message: Schema.String,
    projectId: Schema.String,
  },
) {}

export class TerminalLookupError extends Schema.TaggedErrorClass<TerminalLookupError>()(
  "TerminalLookupError",
  {
    message: Schema.String,
    threadId: Schema.String,
    terminalId: Schema.String,
  },
) {}

export class ProjectActionLookupError extends Schema.TaggedErrorClass<ProjectActionLookupError>()(
  "ProjectActionLookupError",
  {
    message: Schema.String,
    projectId: Schema.String,
    selector: Schema.String,
  },
) {}

export class ProjectActionValidationError extends Schema.TaggedErrorClass<ProjectActionValidationError>()(
  "ProjectActionValidationError",
  {
    message: Schema.String,
    projectId: Schema.String,
  },
) {}

export class ProjectUpdateValidationError extends Schema.TaggedErrorClass<ProjectUpdateValidationError>()(
  "ProjectUpdateValidationError",
  { message: Schema.String, projectId: Schema.String },
) {}

export type DomainError =
  | ProjectLookupError
  | ModelSelectionError
  | ThreadEventError
  | ThreadSessionError
  | ThreadLookupError
  | ProjectCreateVisibilityError
  | TerminalLookupError
  | ProjectActionLookupError
  | ProjectActionValidationError
  | ProjectUpdateValidationError;
