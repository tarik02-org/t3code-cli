import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import {
  MessageId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  type ModelSelection,
  type OrchestrationProjectShell,
  type OrchestrationV2Command,
  type OrchestrationV2ThreadLaunchInput,
  type ProviderApprovalDecision,
  type ProviderUserInputAnswers,
  type ServerConfig,
} from "@t3tools/contracts";
import { makeCommandId } from "./command-id.ts";
import { resolveModelSelection } from "./model-selection.ts";
import type { MessageAuthor, SendMode, SendThreadInput, StartThreadInput } from "./service.ts";

type Command<T extends OrchestrationV2Command["type"]> = Extract<
  OrchestrationV2Command,
  { readonly type: T }
>;

const CREATION = { createdBy: "user", creationSource: "web" } as const;

const makeMessageId = Effect.fn("makeMessageId")(function* () {
  const crypto = yield* Crypto.Crypto;
  return MessageId.make(yield* crypto.randomUUIDv4.pipe(Effect.orDie));
});

export const makeThreadLaunchInput = Effect.fn("makeThreadLaunchInput")(function* (input: {
  readonly start: StartThreadInput;
  readonly project: OrchestrationProjectShell;
  readonly serverConfig: ServerConfig;
}) {
  const crypto = yield* Crypto.Crypto;
  const modelSelection = yield* resolveModelSelection(input);
  const inputTitle = input.start.title?.trim();
  const hasTitle = inputTitle !== undefined && inputTitle.length > 0;
  const messageTitle = input.start.message.trim().split(/\s+/).slice(0, 8).join(" ");
  const worktreePath = input.start.worktreePath;
  return {
    commandId: yield* makeCommandId("thread-launch"),
    creationSource: CREATION.creationSource,
    threadId: ThreadId.make(yield* crypto.randomUUIDv4.pipe(Effect.orDie)),
    projectId: input.project.id,
    title: hasTitle ? inputTitle : messageTitle.length > 0 ? messageTitle : "New thread",
    generateTitle: !hasTitle,
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    workspaceStrategy:
      worktreePath === undefined ? { type: "root" } : { type: "existing_worktree", worktreePath },
    initialMessage: {
      messageId: yield* makeMessageId(),
      text: input.start.message,
      attachments: [],
    },
  } satisfies OrchestrationV2ThreadLaunchInput;
});

export const makeMessageDispatchCommand = Effect.fn("makeMessageDispatchCommand")(function* (
  input: Omit<SendThreadInput, "author"> & {
    readonly modelSelection?: ModelSelection;
    /** Already checked to exist in the target environment. */
    readonly author: MessageAuthor;
  },
) {
  const mode: SendMode = input.mode ?? "auto";
  return {
    type: "message.dispatch",
    // Servers currently restamp websocket commands as user-created; senderThreadId is kept.
    createdBy: input.author.kind,
    creationSource: CREATION.creationSource,
    ...(input.author.kind === "agent" && input.author.senderThreadId !== undefined
      ? { senderThreadId: ThreadId.make(input.author.senderThreadId) }
      : {}),
    commandId: yield* makeCommandId("message-dispatch"),
    threadId: ThreadId.make(input.threadId),
    messageId: yield* makeMessageId(),
    text: input.message,
    attachments: [],
    ...(input.modelSelection !== undefined ? { modelSelection: input.modelSelection } : {}),
    // The server resolves the target run for steer and restart against its serialized state.
    ...(mode === "queue" ? {} : { deliveryIntent: mode }),
    dispatchMode: mode === "queue" ? { type: "queue_after_active" } : { type: "start_immediately" },
  } satisfies Command<"message.dispatch">;
});

export const makeThreadArchiveCommand = Effect.fn("makeThreadArchiveCommand")(function* (
  threadId: string,
) {
  return {
    type: "thread.archive",
    commandId: yield* makeCommandId("thread.archive"),
    threadId: ThreadId.make(threadId),
  } satisfies Command<"thread.archive">;
});

export const makeThreadUnarchiveCommand = Effect.fn("makeThreadUnarchiveCommand")(function* (
  threadId: string,
) {
  return {
    type: "thread.unarchive",
    commandId: yield* makeCommandId("thread.unarchive"),
    threadId: ThreadId.make(threadId),
  } satisfies Command<"thread.unarchive">;
});

export const makeThreadSettleCommand = Effect.fn("makeThreadSettleCommand")(function* (
  threadId: string,
) {
  return {
    type: "thread.settle",
    commandId: yield* makeCommandId("thread.settle"),
    threadId: ThreadId.make(threadId),
  } satisfies Command<"thread.settle">;
});

export const makeThreadPinCommand = Effect.fn("makeThreadPinCommand")(function* (threadId: string) {
  return {
    type: "thread.pin",
    commandId: yield* makeCommandId("thread.pin"),
    threadId: ThreadId.make(threadId),
  } satisfies Command<"thread.pin">;
});

export const makeThreadUnpinCommand = Effect.fn("makeThreadUnpinCommand")(function* (
  threadId: string,
) {
  return {
    type: "thread.unpin",
    commandId: yield* makeCommandId("thread.unpin"),
    threadId: ThreadId.make(threadId),
  } satisfies Command<"thread.unpin">;
});

export const makeThreadDeleteCommand = Effect.fn("makeThreadDeleteCommand")(function* (
  threadId: string,
) {
  return {
    type: "thread.delete",
    commandId: yield* makeCommandId("thread.delete"),
    threadId: ThreadId.make(threadId),
  } satisfies Command<"thread.delete">;
});

export const makeThreadUnsettleCommand = Effect.fn("makeThreadUnsettleCommand")(function* (
  threadId: string,
) {
  return {
    type: "thread.unsettle",
    commandId: yield* makeCommandId("thread.unsettle"),
    threadId: ThreadId.make(threadId),
    reason: "user",
  } satisfies Command<"thread.unsettle">;
});

export const makeThreadSnoozeCommand = Effect.fn("makeThreadSnoozeCommand")(function* (input: {
  readonly threadId: string;
  readonly snoozedUntil: string;
}) {
  return {
    type: "thread.snooze",
    commandId: yield* makeCommandId("thread.snooze"),
    threadId: ThreadId.make(input.threadId),
    snoozedUntil: input.snoozedUntil,
  } satisfies Command<"thread.snooze">;
});

export const makeThreadUnsnoozeCommand = Effect.fn("makeThreadUnsnoozeCommand")(function* (
  threadId: string,
) {
  return {
    type: "thread.unsnooze",
    commandId: yield* makeCommandId("thread.unsnooze"),
    threadId: ThreadId.make(threadId),
    reason: "user",
  } satisfies Command<"thread.unsnooze">;
});

export const makeRunInterruptCommand = Effect.fn("makeRunInterruptCommand")(function* (input: {
  readonly threadId: string;
  readonly runId: string;
}) {
  return {
    type: "run.interrupt",
    commandId: yield* makeCommandId("run.interrupt"),
    threadId: ThreadId.make(input.threadId),
    runId: RunId.make(input.runId),
  } satisfies Command<"run.interrupt">;
});

export const makeRuntimeRequestRespondCommand = Effect.fn("makeRuntimeRequestRespondCommand")(
  function* (
    input: {
      readonly threadId: string;
      readonly requestId: string;
    } & (
      | { readonly decision: ProviderApprovalDecision }
      | { readonly answers: ProviderUserInputAnswers }
    ),
  ) {
    return {
      type: "runtime-request.respond",
      commandId: yield* makeCommandId("runtime-request.respond"),
      threadId: ThreadId.make(input.threadId),
      requestId: RuntimeRequestId.make(input.requestId),
      ...("decision" in input ? { decision: input.decision } : { answers: input.answers }),
    } satisfies Command<"runtime-request.respond">;
  },
);

export const makeThreadMetadataUpdateCommand = Effect.fn("makeThreadMetadataUpdateCommand")(
  function* (
    threadId: string,
    input: {
      readonly title?: string;
      readonly branch?: string | null;
      readonly worktreePath?: string | null;
    },
  ) {
    return {
      type: "thread.metadata.update",
      commandId: yield* makeCommandId("thread.metadata.update"),
      threadId: ThreadId.make(threadId),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.branch !== undefined ? { branch: input.branch } : {}),
      ...(input.worktreePath !== undefined ? { worktreePath: input.worktreePath } : {}),
    } satisfies Command<"thread.metadata.update">;
  },
);

export const makeThreadModelSelectionCommand = Effect.fn("makeThreadModelSelectionCommand")(
  function* (threadId: string, modelSelection: ModelSelection) {
    return {
      type: "thread.model-selection.set",
      commandId: yield* makeCommandId("thread.model-selection.set"),
      threadId: ThreadId.make(threadId),
      modelSelection,
    } satisfies Command<"thread.model-selection.set">;
  },
);

export const makeQueuedRunCancelCommand = Effect.fn("makeQueuedRunCancelCommand")(
  function* (input: { readonly threadId: string; readonly runId: string }) {
    return {
      type: "queued-run.cancel",
      commandId: yield* makeCommandId("queued-run.cancel"),
      threadId: ThreadId.make(input.threadId),
      runId: RunId.make(input.runId),
    } satisfies Command<"queued-run.cancel">;
  },
);

export const makeQueuedRunEditCommand = Effect.fn("makeQueuedRunEditCommand")(function* (input: {
  readonly threadId: string;
  readonly runId: string;
  readonly text: string;
}) {
  return {
    type: "queued-run.edit",
    commandId: yield* makeCommandId("queued-run.edit"),
    threadId: ThreadId.make(input.threadId),
    runId: RunId.make(input.runId),
    text: input.text,
  } satisfies Command<"queued-run.edit">;
});

export const makeQueuedRunReorderCommand = Effect.fn("makeQueuedRunReorderCommand")(
  function* (input: {
    readonly threadId: string;
    readonly runId: string;
    readonly beforeRunId: string | null;
  }) {
    return {
      type: "queued-run.reorder",
      commandId: yield* makeCommandId("queued-run.reorder"),
      threadId: ThreadId.make(input.threadId),
      runId: RunId.make(input.runId),
      beforeRunId: input.beforeRunId === null ? null : RunId.make(input.beforeRunId),
    } satisfies Command<"queued-run.reorder">;
  },
);

export const makeQueuedRunSteerCommand = Effect.fn("makeQueuedRunSteerCommand")(function* (input: {
  readonly threadId: string;
  readonly queuedRunId: string;
  readonly targetRunId: string;
}) {
  return {
    type: "queued-message.promote-to-steer",
    commandId: yield* makeCommandId("queued-message.promote-to-steer"),
    threadId: ThreadId.make(input.threadId),
    queuedRunId: RunId.make(input.queuedRunId),
    targetRunId: RunId.make(input.targetRunId),
  } satisfies Command<"queued-message.promote-to-steer">;
});

export const makeQueueResumeCommand = Effect.fn("makeQueueResumeCommand")(function* (
  threadId: string,
) {
  return {
    type: "queue.resume",
    commandId: yield* makeCommandId("queue.resume"),
    threadId: ThreadId.make(threadId),
  } satisfies Command<"queue.resume">;
});
