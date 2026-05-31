import * as Schema from "effect/Schema";

export type Format = "human" | "json" | "ndjson";

export const FormatSchema = Schema.Literals(["human", "json", "ndjson"]);

export const ModelSelectionSchema = Schema.Struct({
  instanceId: Schema.String,
  model: Schema.String,
  options: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        value: Schema.Unknown,
      }),
    ),
  ),
});
export type ModelSelection = typeof ModelSelectionSchema.Type;

export const ProjectShellSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  workspaceRoot: Schema.String,
  defaultModelSelection: Schema.NullOr(ModelSelectionSchema),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type ProjectShell = typeof ProjectShellSchema.Type;

export const ThreadMessageSchema = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  messageId: Schema.optionalKey(Schema.String),
  role: Schema.Literals(["user", "assistant", "system"]),
  text: Schema.String,
  streaming: Schema.optionalKey(Schema.Boolean),
  turnId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type ThreadMessage = typeof ThreadMessageSchema.Type;

export const ThreadSessionSchema = Schema.Struct({
  threadId: Schema.String,
  status: Schema.Literals([
    "idle",
    "starting",
    "running",
    "ready",
    "interrupted",
    "stopped",
    "error",
  ]),
  lastError: Schema.NullOr(Schema.String),
  updatedAt: Schema.String,
});
export type ThreadSession = typeof ThreadSessionSchema.Type;

export const ThreadShellSchema = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  title: Schema.String,
  modelSelection: ModelSelectionSchema,
  runtimeMode: Schema.String,
  interactionMode: Schema.String,
  branch: Schema.NullOr(Schema.String),
  worktreePath: Schema.NullOr(Schema.String),
  latestTurn: Schema.NullOr(Schema.Struct({ state: Schema.String })),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  session: Schema.NullOr(ThreadSessionSchema),
  latestUserMessageAt: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export type ThreadShell = typeof ThreadShellSchema.Type;

export const ThreadDetailSchema = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  title: Schema.String,
  modelSelection: ModelSelectionSchema,
  runtimeMode: Schema.String,
  interactionMode: Schema.String,
  branch: Schema.NullOr(Schema.String),
  worktreePath: Schema.NullOr(Schema.String),
  latestTurn: Schema.NullOr(Schema.Struct({ state: Schema.String })),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  session: Schema.NullOr(ThreadSessionSchema),
  latestUserMessageAt: Schema.optionalKey(Schema.NullOr(Schema.String)),
  messages: Schema.Array(ThreadMessageSchema),
  activities: Schema.optionalKey(Schema.Array(Schema.Unknown)),
});
export type ThreadDetail = typeof ThreadDetailSchema.Type;

export const ShellSnapshotSchema = Schema.Struct({
  snapshotSequence: Schema.Number,
  projects: Schema.Array(ProjectShellSchema),
  threads: Schema.Array(ThreadShellSchema),
  updatedAt: Schema.String,
});
export type ShellSnapshot = typeof ShellSnapshotSchema.Type;

const ServerProviderSchema = Schema.Struct({
  instanceId: Schema.String,
  enabled: Schema.optionalKey(Schema.Boolean),
  installed: Schema.optionalKey(Schema.Boolean),
  availability: Schema.optionalKey(Schema.String),
  models: Schema.optionalKey(
    Schema.Array(
      Schema.Union([
        Schema.String,
        Schema.Struct({
          id: Schema.optionalKey(Schema.String),
          name: Schema.optionalKey(Schema.String),
        }),
      ]),
    ),
  ),
});

export const ServerConfigSchema = Schema.Struct({
  providers: Schema.optionalKey(Schema.Array(ServerProviderSchema)),
});
export type ServerConfig = typeof ServerConfigSchema.Type;

export const ThreadMessageSentEventSchema = Schema.Struct({
  type: Schema.Literal("thread.message-sent"),
  payload: Schema.Struct({
    messageId: Schema.String,
    role: Schema.Literals(["user", "assistant", "system"]),
    text: Schema.String,
    turnId: Schema.NullOr(Schema.String),
    streaming: Schema.optionalKey(Schema.Boolean),
    createdAt: Schema.String,
    updatedAt: Schema.String,
  }),
});
export type ThreadMessageSentEvent = typeof ThreadMessageSentEventSchema.Type;

export const ThreadSessionSetEventSchema = Schema.Struct({
  type: Schema.Literal("thread.session-set"),
  payload: Schema.Struct({
    session: Schema.NullOr(ThreadSessionSchema),
  }),
});
export type ThreadSessionSetEvent = typeof ThreadSessionSetEventSchema.Type;

export const UnknownThreadEventSchema = Schema.Struct({
  type: Schema.String,
  payload: Schema.Record(Schema.String, Schema.Unknown),
});
export type UnknownThreadEvent = typeof UnknownThreadEventSchema.Type;

export const ThreadEventSchema = Schema.Union([
  ThreadMessageSentEventSchema,
  ThreadSessionSetEventSchema,
  UnknownThreadEventSchema,
]);
export type ThreadEvent = typeof ThreadEventSchema.Type;

export const decodeModelSelection = Schema.decodeUnknownSync(ModelSelectionSchema);
