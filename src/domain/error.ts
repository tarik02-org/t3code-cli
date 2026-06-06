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

export type DomainError =
  | ProjectLookupError
  | ModelSelectionError
  | ThreadEventError
  | ThreadSessionError
  | ThreadLookupError
  | ProjectCreateVisibilityError
  | TerminalLookupError;
type TaggedLike = object & { readonly _tag?: string };

export function isTerminalLookupError(error: TaggedLike): error is TerminalLookupError {
  return hasTag(error, "TerminalLookupError");
}

function hasTag(error: TaggedLike, tag: string): error is { readonly _tag: string } {
  return error?.["_tag"] === tag;
}
