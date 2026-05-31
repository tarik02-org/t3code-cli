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
    const threadId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const modelSelection = yield* resolveModelSelection(input);
    const inputTitle = input.start.title?.trim();
    const messageTitle = input.start.message.trim().split(/\s+/).slice(0, 8).join(" ");
    const title = inputTitle !== undefined && inputTitle.length > 0 ? inputTitle : messageTitle;
    return {
      type: "thread.turn.start",
      commandId: `t3cli:thread-start:${crypto.randomUUID()}`,
      threadId,
      message: {
        messageId: crypto.randomUUID(),
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

export function makeThreadTurnContinueCommand(input: SendThreadInput) {
  return {
    type: "thread.turn.start",
    commandId: `t3cli:thread-start:${crypto.randomUUID()}`,
    threadId: input.threadId,
    message: {
      messageId: crypto.randomUUID(),
      role: "user",
      text: input.message,
      attachments: [],
    },
    titleSeed: "",
    runtimeMode: "full-access",
    interactionMode: "default",
    bootstrap: {},
    createdAt: new Date().toISOString(),
  } satisfies ThreadTurnStartCommand;
}

export function makeThreadArchiveCommand(threadId: string) {
  return {
    type: "thread.archive",
    commandId: `t3cli:thread-archive:${crypto.randomUUID()}`,
    threadId,
  } satisfies ThreadArchiveCommand;
}
