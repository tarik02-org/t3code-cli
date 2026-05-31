import * as Effect from "effect/Effect";
import type * as Path from "effect/Path";

import { decodeModelSelection, type ProjectShell, type ServerConfig } from "./schema.ts";
import type {
  ProjectCreateCommand,
  ThreadArchiveCommand,
  ThreadTurnStartCommand,
} from "./command-schema.ts";
import { ModelSelectionError } from "./error.ts";
import type { SendThreadInput, StartThreadInput } from "./service.ts";

export function makeProjectCreateCommand(
  input: {
    readonly path: string;
    readonly title?: string;
  },
  path: Path.Path,
  cwd: string,
) {
  const workspaceRoot = path.resolve(cwd, input.path);
  const projectId = crypto.randomUUID();
  return {
    type: "project.create",
    commandId: makeCommandId("project-create"),
    projectId,
    title: input.title?.trim() || titleFromPath(workspaceRoot, path),
    workspaceRoot,
    createdAt: nowIso(),
  } satisfies ProjectCreateCommand & { readonly projectId: string };
}

export const makeThreadTurnStartCommand = Effect.fn("makeThreadTurnStartCommand")(
  function* (input: {
    readonly start: StartThreadInput;
    readonly project: ProjectShell;
    readonly serverConfig: ServerConfig;
  }) {
    const threadId = crypto.randomUUID();
    const createdAt = nowIso();
    const modelSelection = yield* resolveModelSelection(input);
    const title =
      input.start.title?.trim() || input.start.message.trim().split(/\s+/).slice(0, 8).join(" ");
    return {
      type: "thread.turn.start",
      commandId: makeCommandId("thread-start"),
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
          title: title || "New thread",
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
  const createdAt = nowIso();
  return {
    type: "thread.turn.start",
    commandId: makeCommandId("thread-start"),
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
    createdAt,
  } satisfies ThreadTurnStartCommand;
}

export function makeThreadArchiveCommand(threadId: string) {
  return {
    type: "thread.archive",
    commandId: makeCommandId("thread-archive"),
    threadId,
  } satisfies ThreadArchiveCommand;
}

function resolveModelSelection(input: {
  readonly start: StartThreadInput;
  readonly project: ProjectShell;
  readonly serverConfig: ServerConfig;
}) {
  return Effect.gen(function* () {
    if (input.start.provider || input.start.model) {
      const base =
        input.project.defaultModelSelection ?? (yield* firstAvailableModel(input.serverConfig));
      return {
        instanceId: input.start.provider ?? base.instanceId,
        model: input.start.model ?? base.model,
        ...(base.options ? { options: base.options } : {}),
      };
    }
    if (input.project.defaultModelSelection) return input.project.defaultModelSelection;
    return yield* firstAvailableModel(input.serverConfig);
  });
}

function firstAvailableModel(serverConfig: ServerConfig) {
  const provider = serverConfig.providers?.find(
    (entry) =>
      entry.enabled !== false &&
      entry.installed !== false &&
      entry.availability !== "unavailable" &&
      entry.models &&
      entry.models.length > 0,
  );
  const model = provider?.models?.[0];
  const modelId = typeof model === "string" ? model : (model?.id ?? model?.name);
  if (!provider?.instanceId || !modelId) {
    return Effect.fail(
      new ModelSelectionError({
        message: "no available provider model found; pass --provider and --model",
      }),
    );
  }
  return Effect.succeed(
    decodeModelSelection({
      instanceId: provider.instanceId,
      model: modelId,
    }),
  );
}

function nowIso() {
  return new Date().toISOString();
}

function makeCommandId(prefix: string) {
  return `t3cli:${prefix}:${crypto.randomUUID()}`;
}

function titleFromPath(filePath: string, path: Path.Path) {
  return path.basename(filePath);
}
