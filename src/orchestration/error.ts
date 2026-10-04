import * as Schema from "effect/Schema";

export class ThreadSnapshotRequestError extends Schema.TaggedError<ThreadSnapshotRequestError>()(
  "ThreadSnapshotRequestError",
  {
    message: Schema.String,
    threadId: Schema.String,
    cause: Schema.Defect(),
  },
) {}
