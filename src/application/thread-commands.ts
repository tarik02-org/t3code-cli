import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import {
  ApprovalRequestId,
  CommandId,
  MessageId,
  ThreadId,
  type ClientOrchestrationCommand,
  type ModelSelection,
  type OrchestrationProjectShell,
  type ProviderApprovalDecision,
  type ProviderUserInputAnswers,
} from "#t3tools/contracts";
import type { ServerConfigForCli } from "../orchestration/service.ts";
import { resolveModelSelection } from "./model-selection.ts";
import type { SendThreadInput, StartThreadInput } from "./service.ts";

export const makeThreadStartCommands = Effect.fn("makeThreadStartCommands")(function* (input: {
  readonly start: StartThreadInput;
  readonly project: OrchestrationProjectShell;
  readonly serverConfig: ServerConfigForCli;
}) {
  const crypto = yield* Crypto.Crypto;
  const threadId = ThreadId.make(yield* crypto.randomUUIDv4.pipe(Effect.orDie));
  const createdAt = DateTime.formatIso(yield* DateTime.now);
  const modelSelection = yield* resolveModelSelection(input);
  const inputTitle = input.start.title?.trim();
  const messageTitle = input.start.message.trim().split(/\s+/).slice(0, 8).join(" ");
  const title = inputTitle !== undefined && inputTitle.length > 0 ? inputTitle : messageTitle;
  const createCommand = {
    type: "thread.create",
    commandId: CommandId.make(
      `t3cli:thread-create:${yield* crypto.randomUUIDv4.pipe(Effect.orDie)}`,
    ),
    threadId,
    projectId: input.project.id,
    title: title.length > 0 ? title : "New thread",
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: input.start.worktreePath ?? null,
    createdAt,
  } satisfies Extract<ClientOrchestrationCommand, { readonly type: "thread.create" }>;
  const turnCommand = {
    type: "thread.turn.start",
    commandId: CommandId.make(
      `t3cli:thread-start:${yield* crypto.randomUUIDv4.pipe(Effect.orDie)}`,
    ),
    threadId,
    message: {
      messageId: MessageId.make(yield* crypto.randomUUIDv4.pipe(Effect.orDie)),
      role: "user",
      text: input.start.message,
      attachments: [],
    },
    modelSelection,
    titleSeed: title,
    runtimeMode: "full-access",
    interactionMode: "default",
    createdAt,
  } satisfies Extract<ClientOrchestrationCommand, { readonly type: "thread.turn.start" }>;
  return { createCommand, turnCommand, threadId };
});

export const makeThreadTurnContinueCommand = Effect.fn("makeThreadTurnContinueCommand")(function* (
  input: SendThreadInput & { readonly modelSelection?: ModelSelection },
) {
  const crypto = yield* Crypto.Crypto;
  const createdAt = DateTime.formatIso(yield* DateTime.now);
  return {
    type: "thread.turn.start",
    commandId: CommandId.make(
      `t3cli:thread-start:${yield* crypto.randomUUIDv4.pipe(Effect.orDie)}`,
    ),
    threadId: ThreadId.make(input.threadId),
    message: {
      messageId: MessageId.make(yield* crypto.randomUUIDv4.pipe(Effect.orDie)),
      role: "user",
      text: input.message,
      attachments: [],
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    ...(input.modelSelection !== undefined ? { modelSelection: input.modelSelection } : {}),
    createdAt,
  } satisfies Extract<ClientOrchestrationCommand, { readonly type: "thread.turn.start" }>;
});

export const makeThreadArchiveCommand = Effect.fn("makeThreadArchiveCommand")(function* (
  threadId: string,
) {
  const crypto = yield* Crypto.Crypto;
  return {
    type: "thread.archive",
    commandId: CommandId.make(
      `t3cli:thread-archive:${yield* crypto.randomUUIDv4.pipe(Effect.orDie)}`,
    ),
    threadId: ThreadId.make(threadId),
  } satisfies Extract<ClientOrchestrationCommand, { readonly type: "thread.archive" }>;
});

export const makeThreadApprovalRespondCommand = Effect.fn("makeThreadApprovalRespondCommand")(
  function* (input: {
    readonly threadId: string;
    readonly requestId: string;
    readonly decision: ProviderApprovalDecision;
  }) {
    const crypto = yield* Crypto.Crypto;
    const createdAt = DateTime.formatIso(yield* DateTime.now);
    return {
      type: "thread.approval.respond",
      commandId: CommandId.make(
        `t3cli:thread-approve:${yield* crypto.randomUUIDv4.pipe(Effect.orDie)}`,
      ),
      threadId: ThreadId.make(input.threadId),
      requestId: ApprovalRequestId.make(input.requestId),
      decision: input.decision,
      createdAt,
    } satisfies Extract<ClientOrchestrationCommand, { readonly type: "thread.approval.respond" }>;
  },
);

export const makeThreadUserInputRespondCommand = Effect.fn("makeThreadUserInputRespondCommand")(
  function* (input: {
    readonly threadId: string;
    readonly requestId: string;
    readonly answers: ProviderUserInputAnswers;
  }) {
    const crypto = yield* Crypto.Crypto;
    const createdAt = DateTime.formatIso(yield* DateTime.now);
    return {
      type: "thread.user-input.respond",
      commandId: CommandId.make(
        `t3cli:thread-respond:${yield* crypto.randomUUIDv4.pipe(Effect.orDie)}`,
      ),
      threadId: ThreadId.make(input.threadId),
      requestId: ApprovalRequestId.make(input.requestId),
      answers: input.answers,
      createdAt,
    } satisfies Extract<ClientOrchestrationCommand, { readonly type: "thread.user-input.respond" }>;
  },
);

export const makeThreadMetaUpdateCommand = Effect.fn("makeThreadMetaUpdateCommand")(function* (
  threadId: string,
  input: {
    readonly title?: string;
    readonly modelSelection?: ModelSelection;
    readonly branch?: string | null;
    readonly worktreePath?: string | null;
  },
) {
  const crypto = yield* Crypto.Crypto;
  return {
    type: "thread.meta.update",
    commandId: CommandId.make(
      `t3cli:thread-meta-update:${yield* crypto.randomUUIDv4.pipe(Effect.orDie)}`,
    ),
    threadId: ThreadId.make(threadId),
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.modelSelection !== undefined ? { modelSelection: input.modelSelection } : {}),
    ...(input.branch !== undefined ? { branch: input.branch } : {}),
    ...(input.worktreePath !== undefined ? { worktreePath: input.worktreePath } : {}),
  } satisfies Extract<ClientOrchestrationCommand, { readonly type: "thread.meta.update" }>;
});
