import * as Schema from "effect/Schema";

export class ThreadSnapshotRequestError extends Schema.TaggedErrorClass<ThreadSnapshotRequestError>()(
  "ThreadSnapshotRequestError",
  {
    message: Schema.String,
    threadId: Schema.String,
    cause: Schema.Defect(),
  },
) {}
