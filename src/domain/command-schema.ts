import * as Schema from "effect/Schema";

import { ModelSelectionSchema } from "./schema.ts";

export const DispatchResultSchema = Schema.Struct({
  sequence: Schema.Number,
});
export type DispatchResult = typeof DispatchResultSchema.Type;

export const ProjectCreateCommandSchema = Schema.Struct({
  type: Schema.Literal("project.create"),
  commandId: Schema.String,
  projectId: Schema.String,
  title: Schema.String,
  workspaceRoot: Schema.String,
  createdAt: Schema.String,
});
export type ProjectCreateCommand = typeof ProjectCreateCommandSchema.Type;

export const ThreadTurnStartCommandSchema = Schema.Struct({
  type: Schema.Literal("thread.turn.start"),
  commandId: Schema.String,
  threadId: Schema.String,
  message: Schema.Struct({
    messageId: Schema.String,
    role: Schema.Literal("user"),
    text: Schema.String,
    attachments: Schema.Array(Schema.Never),
  }),
  modelSelection: Schema.optionalKey(ModelSelectionSchema),
  titleSeed: Schema.optionalKey(Schema.String),
  runtimeMode: Schema.Literal("full-access"),
  interactionMode: Schema.Literal("default"),
  bootstrap: Schema.optionalKey(
    Schema.Struct({
      createThread: Schema.optionalKey(
        Schema.Struct({
          projectId: Schema.String,
          title: Schema.String,
          modelSelection: ModelSelectionSchema,
          runtimeMode: Schema.Literal("full-access"),
          interactionMode: Schema.Literal("default"),
          branch: Schema.Null,
          worktreePath: Schema.NullOr(Schema.String),
          createdAt: Schema.String,
        }),
      ),
    }),
  ),
  createdAt: Schema.String,
});
export type ThreadTurnStartCommand = typeof ThreadTurnStartCommandSchema.Type;

export const ThreadArchiveCommandSchema = Schema.Struct({
  type: Schema.Literal("thread.archive"),
  commandId: Schema.String,
  threadId: Schema.String,
});
export type ThreadArchiveCommand = typeof ThreadArchiveCommandSchema.Type;

export const ClientOrchestrationCommandSchema = Schema.Union([
  ProjectCreateCommandSchema,
  ThreadArchiveCommandSchema,
  ThreadTurnStartCommandSchema,
]);
export type ClientOrchestrationCommand = typeof ClientOrchestrationCommandSchema.Type;
