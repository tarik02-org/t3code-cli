import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import type { ThreadArchiveCommand, ThreadTurnStartCommand } from "../domain/command-schema.ts";
import type { ProjectShell, ServerConfig } from "../domain/schema.ts";
import { resolveModelSelection } from "./model-selection.ts";
import type { SendThreadInput, StartThreadInput } from "./service.ts";

export const makeThreadTurnStartCommand = Effect.fn("makeThreadTurnStartCommand")(
  function* (input: {
    readonly start: StartThreadInput;
    readonly project: ProjectShell;
    readonly serverConfig: ServerConfig;
  }) {
    const crypto = yield* Crypto.Crypto;
    const threadId = yield* crypto.randomUUIDv4.pipe(Effect.orDie);
    const createdAt = DateTime.formatIso(yield* DateTime.now);
    const modelSelection = yield* resolveModelSelection(input);
    const inputTitle = input.start.title?.trim();
    const messageTitle = input.start.message.trim().split(/\s+/).slice(0, 8).join(" ");
    const title = inputTitle !== undefined && inputTitle.length > 0 ? inputTitle : messageTitle;
    return {
      type: "thread.turn.start",
      commandId: `t3cli:thread-start:${yield* crypto.randomUUIDv4.pipe(Effect.orDie)}`,
      threadId,
      message: {
        messageId: yield* crypto.randomUUIDv4.pipe(Effect.orDie),
        role: "user",
        text: input.start.message,
        attachments: [],
      },
      modelSelection,
      titleSeed: title,
      runtimeMode: "full-access",
      interactionMode: "default",
      bootstrap: {
        createThread: {
          projectId: input.project.id,
          title: title.length > 0 ? title : "New thread",
          modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: input.start.worktreePath ?? null,
          createdAt,
        },
      },
      createdAt,
    } satisfies ThreadTurnStartCommand & { readonly threadId: string };
  },
);

export const makeThreadTurnContinueCommand = Effect.fn("makeThreadTurnContinueCommand")(function* (
  input: SendThreadInput,
) {
  const crypto = yield* Crypto.Crypto;
  const createdAt = DateTime.formatIso(yield* DateTime.now);
  return {
    type: "thread.turn.start",
    commandId: `t3cli:thread-start:${yield* crypto.randomUUIDv4.pipe(Effect.orDie)}`,
    threadId: input.threadId,
    message: {
      messageId: yield* crypto.randomUUIDv4.pipe(Effect.orDie),
      role: "user",
      text: input.message,
      attachments: [],
    },
    titleSeed: "",
    runtimeMode: "full-access",
    interactionMode: "default",
    bootstrap: {},
    createdAt,
  } satisfies ThreadTurnStartCommand;
});

export const makeThreadArchiveCommand = Effect.fn("makeThreadArchiveCommand")(function* (
  threadId: string,
) {
  const crypto = yield* Crypto.Crypto;
  return {
    type: "thread.archive",
    commandId: `t3cli:thread-archive:${yield* crypto.randomUUIDv4.pipe(Effect.orDie)}`,
    threadId,
  } satisfies ThreadArchiveCommand;
});
