import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import {
  MAX_SCRIPT_ID_LENGTH,
  SCRIPT_RUN_COMMAND_PATTERN,
  type OrchestrationProjectShell,
  type OrchestrationShellSnapshot,
  type ProjectScript,
} from "#t3tools/contracts";

import {
  ProjectActionLookupError,
  ProjectActionValidationError,
  ProjectLookupError,
  ThreadLookupError,
} from "../domain/error.ts";
import { findProjectById, resolveProjectScope } from "../domain/helpers.ts";
import { T3Orchestration } from "../orchestration/service.ts";
import { makeProjectMetaUpdateCommand } from "./project-commands.ts";
import { waitForShellSequence } from "./shell-sequence.ts";
import {
  T3TerminalApplication,
  type AddProjectActionInput,
  type ProjectActionSelector,
  type T3ActionApplicationService,
  type UpdateProjectActionInput,
} from "./service.ts";

const DEFAULT_ACTION_ICON = "play";
const isScriptRunCommand = Schema.is(SCRIPT_RUN_COMMAND_PATTERN);
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type MutablePartial<T> = { -readonly [K in keyof T]?: T[K] };

export const makeActionApplication = Effect.fn("makeActionApplication")(function* () {
  const orchestration = yield* T3Orchestration;
  const terminalApplication = yield* T3TerminalApplication;
  const crypto = yield* Crypto.Crypto;
  const path = yield* Path.Path;

  const resolveProject = Effect.fn("T3ActionApplication.resolveProject")(function* (
    snapshot: OrchestrationShellSnapshot,
    projectRef: string,
  ) {
    const scope = yield* resolveProjectScope(snapshot, { ref: projectRef }).pipe(
      Effect.provideService(Path.Path, path),
    );
    if (scope === undefined) {
      return yield* Effect.fail(
        new ProjectLookupError({
          message: `project not found: ${projectRef}`,
          ref: projectRef,
        }),
      );
    }
    return scope.project;
  });

  const dispatchScriptsUpdate = Effect.fn("T3ActionApplication.dispatchScriptsUpdate")(function* (
    projectId: string,
    scripts: ReadonlyArray<ProjectScript>,
  ) {
    const command = yield* makeProjectMetaUpdateCommand({
      projectId,
      scripts: [...scripts],
    }).pipe(Effect.provideService(Crypto.Crypto, crypto));
    const dispatch = yield* orchestration.dispatch(command);
    const snapshot = yield* waitForShellSequence({ sequence: dispatch.sequence }).pipe(
      Effect.provideService(T3Orchestration, orchestration),
    );
    const project = findProjectById(snapshot, projectId);
    if (project === null) {
      return yield* Effect.fail(
        new ProjectLookupError({
          message: `project not found after action update: ${projectId}`,
          ref: projectId,
        }),
      );
    }
    return { dispatch, project };
  });

  const listActions: T3ActionApplicationService["listActions"] = Effect.fn(
    "T3ActionApplication.listActions",
  )(function* (projectRef: string) {
    const snapshot = yield* orchestration.getShellSnapshot();
    const project = yield* resolveProject(snapshot, projectRef);
    return { project, actions: project.scripts };
  });

  const addAction: T3ActionApplicationService["addAction"] = Effect.fn(
    "T3ActionApplication.addAction",
  )(function* (input: AddProjectActionInput) {
    const snapshot = yield* orchestration.getShellSnapshot();
    const project = yield* resolveProject(snapshot, input.projectRef);
    const name = yield* requireTrimmedNonEmpty(input.name, "action name", project.id);
    const command = yield* requireTrimmedNonEmpty(input.command, "action command", project.id);
    const id =
      input.id !== undefined
        ? yield* requireProjectScriptId(input.id, project.id)
        : nextProjectScriptId(
            name,
            project.scripts.map((script) => script.id),
          );
    yield* validateUnusedId(project, id);
    const preview = yield* normalizePreviewInput({
      projectId: project.id,
      autoOpenPreview: input.autoOpenPreview ?? false,
      ...(input.previewUrl !== undefined ? { previewUrl: input.previewUrl } : {}),
    });
    const action: ProjectScript = {
      id,
      name,
      command,
      icon: input.icon ?? DEFAULT_ACTION_ICON,
      runOnWorktreeCreate: input.setup === true,
      ...preview,
    };
    const nextScripts = enforceSingleSetup(
      [...project.scripts, action],
      action.runOnWorktreeCreate ? action.id : null,
    );
    const result = yield* dispatchScriptsUpdate(project.id, nextScripts);
    const persisted = yield* resolveActionBySelectorEffect(
      result.project.scripts,
      { id: action.id },
      project.id,
    );
    return { ...result, action: persisted };
  });

  const updateAction: T3ActionApplicationService["updateAction"] = Effect.fn(
    "T3ActionApplication.updateAction",
  )(function* (input: UpdateProjectActionInput) {
    const snapshot = yield* orchestration.getShellSnapshot();
    const project = yield* resolveProject(snapshot, input.projectRef);
    const existing = yield* resolveActionBySelectorEffect(
      project.scripts,
      input.selector,
      project.id,
    );
    const updated = yield* normalizeActionUpdate(project.id, existing, input);
    const nextScripts = enforceSingleSetup(
      project.scripts.map((script) => (script.id === existing.id ? updated : script)),
      updated.runOnWorktreeCreate ? updated.id : null,
    );
    const result = yield* dispatchScriptsUpdate(project.id, nextScripts);
    const persisted = yield* resolveActionBySelectorEffect(
      result.project.scripts,
      { id: existing.id },
      project.id,
    );
    return { ...result, action: persisted };
  });

  const deleteAction: T3ActionApplicationService["deleteAction"] = Effect.fn(
    "T3ActionApplication.deleteAction",
  )(function* (input: { readonly projectRef: string; readonly selector: ProjectActionSelector }) {
    const snapshot = yield* orchestration.getShellSnapshot();
    const project = yield* resolveProject(snapshot, input.projectRef);
    const action = yield* resolveActionBySelectorEffect(
      project.scripts,
      input.selector,
      project.id,
    );
    const nextScripts = project.scripts.filter((script) => script.id !== action.id);
    const result = yield* dispatchScriptsUpdate(project.id, nextScripts);
    return { ...result, action };
  });

  const runAction: T3ActionApplicationService["runAction"] = Effect.fn(
    "T3ActionApplication.runAction",
  )(function* (input: {
    readonly threadId: string;
    readonly selector: ProjectActionSelector;
    readonly terminalId?: string;
  }) {
    const snapshot = yield* orchestration.getShellSnapshot();
    const thread = snapshot.threads.find((candidate) => candidate.id === input.threadId);
    if (thread === undefined) {
      return yield* Effect.fail(
        new ThreadLookupError({
          message: `thread not found: ${input.threadId}`,
          threadId: input.threadId,
        }),
      );
    }
    const project = findProjectById(snapshot, thread.projectId);
    if (project === null) {
      return yield* Effect.fail(
        new ProjectLookupError({
          message: `project not found for thread: ${input.threadId}`,
          ref: thread.projectId,
        }),
      );
    }
    const action = yield* resolveActionBySelectorEffect(
      project.scripts,
      input.selector,
      project.id,
    );
    const env = {
      T3CODE_PROJECT_ROOT: project.workspaceRoot,
      ...(thread.worktreePath !== null ? { T3CODE_WORKTREE_PATH: thread.worktreePath } : {}),
    };
    const terminal = yield* terminalApplication.createTerminal({
      threadId: thread.id,
      command: action.command,
      env,
      ...(input.terminalId !== undefined ? { terminalId: input.terminalId } : {}),
    });
    return { project, action, terminal };
  });

  return {
    addAction,
    deleteAction,
    listActions,
    runAction,
    updateAction,
  } satisfies T3ActionApplicationService;
});

export function nextProjectScriptId(name: string, existingIds: Iterable<string>): string {
  const taken = new Set(Array.from(existingIds));
  const baseId = normalizeScriptId(name);
  if (!taken.has(baseId)) {
    return baseId;
  }

  let suffix = 2;
  while (suffix < 10_000) {
    const candidate = `${baseId}-${suffix}`;
    const safeCandidate =
      candidate.length <= MAX_SCRIPT_ID_LENGTH
        ? candidate
        : `${baseId.slice(0, Math.max(1, MAX_SCRIPT_ID_LENGTH - String(suffix).length - 1))}-${suffix}`;
    if (!taken.has(safeCandidate)) {
      return safeCandidate;
    }
    suffix += 1;
  }

  return `${baseId}-${Date.now()}`.slice(0, MAX_SCRIPT_ID_LENGTH);
}

export function resolveActionBySelector(
  scripts: ReadonlyArray<ProjectScript>,
  selector: ProjectActionSelector,
  projectId: string,
): ProjectScript {
  const result = resolveActionSelector(scripts, selector, projectId);
  if ("action" in result) {
    return result.action;
  }
  throw result.error;
}

function resolveActionBySelectorEffect(
  scripts: ReadonlyArray<ProjectScript>,
  selector: ProjectActionSelector,
  projectId: string,
) {
  const result = resolveActionSelector(scripts, selector, projectId);
  if ("action" in result) {
    return Effect.succeed(result.action);
  }
  return Effect.fail(result.error);
}

function resolveActionSelector(
  scripts: ReadonlyArray<ProjectScript>,
  selector: ProjectActionSelector,
  projectId: string,
): { readonly action: ProjectScript } | { readonly error: ProjectActionLookupError } {
  if (selector.id !== undefined) {
    const id = selector.id.trim();
    const match = scripts.find((script) => script.id === id);
    if (match !== undefined) {
      return { action: match };
    }
    return {
      error: new ProjectActionLookupError({
        message: `action not found by id: ${id}`,
        projectId,
        selector: `id:${id}`,
      }),
    };
  }

  const normalized = selector.name.trim().toLowerCase();
  const matches = scripts.filter((script) => script.name.trim().toLowerCase() === normalized);
  if (matches.length === 1) {
    return { action: matches[0]! };
  }
  if (matches.length === 0) {
    return {
      error: new ProjectActionLookupError({
        message: `action not found by name: ${selector.name.trim()}`,
        projectId,
        selector: `name:${selector.name.trim()}`,
      }),
    };
  }
  return {
    error: new ProjectActionLookupError({
      message: `action name is ambiguous: ${selector.name.trim()} matched ${matches.length} actions`,
      projectId,
      selector: `name:${selector.name.trim()}`,
    }),
  };
}

function normalizeScriptId(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (cleaned.length === 0) {
    return "script";
  }
  if (cleaned.length <= MAX_SCRIPT_ID_LENGTH) {
    return cleaned;
  }
  const truncated = cleaned.slice(0, MAX_SCRIPT_ID_LENGTH).replace(/-+$/g, "");
  return truncated.length > 0 ? truncated : "script";
}

function validateUnusedId(project: OrchestrationProjectShell, id: string) {
  if (project.scripts.some((script) => script.id === id)) {
    return Effect.fail(
      new ProjectActionValidationError({
        message: `action id already exists: ${id}`,
        projectId: project.id,
      }),
    );
  }
  return Effect.void;
}

function requireProjectScriptId(value: string, projectId: string) {
  return Effect.gen(function* () {
    const id = yield* requireTrimmedNonEmpty(value, "action id", projectId);
    if (!isScriptRunCommand(`script.${id}.run`)) {
      return yield* Effect.fail(
        new ProjectActionValidationError({
          message: `action id must be lowercase alphanumeric or hyphenated and at most ${MAX_SCRIPT_ID_LENGTH} characters`,
          projectId,
        }),
      );
    }
    return id;
  });
}

function requireTrimmedNonEmpty(value: string, field: string, projectId: string) {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return Effect.fail(
      new ProjectActionValidationError({
        message: `${field} must not be empty`,
        projectId,
      }),
    );
  }
  return Effect.succeed(trimmed);
}

function enforceSingleSetup(
  scripts: ReadonlyArray<ProjectScript>,
  setupActionId: string | null,
): ReadonlyArray<ProjectScript> {
  if (setupActionId === null) {
    return scripts;
  }
  return scripts.map((script) =>
    script.id === setupActionId
      ? { ...script, runOnWorktreeCreate: true }
      : script.runOnWorktreeCreate
        ? { ...script, runOnWorktreeCreate: false }
        : script,
  );
}

function normalizePreviewInput(input: {
  readonly projectId: string;
  readonly previewUrl?: string;
  readonly autoOpenPreview: boolean;
}) {
  return Effect.gen(function* () {
    const previewUrl = input.previewUrl?.trim();
    if (previewUrl !== undefined && previewUrl.length > 0) {
      return {
        previewUrl,
        ...(input.autoOpenPreview ? { autoOpenPreview: true } : {}),
      } satisfies Partial<ProjectScript>;
    }
    if (input.autoOpenPreview) {
      return yield* Effect.fail(
        new ProjectActionValidationError({
          message: "--auto-open-preview requires --preview-url",
          projectId: input.projectId,
        }),
      );
    }
    return {};
  });
}

function normalizeActionUpdate(
  projectId: string,
  existing: ProjectScript,
  input: UpdateProjectActionInput,
) {
  return Effect.gen(function* () {
    const patch: MutablePartial<ProjectScript> = {};
    let clearPreviewUrl = false;
    let clearAutoOpenPreview = false;
    if (input.name !== undefined) {
      patch.name = yield* requireTrimmedNonEmpty(input.name, "action name", projectId);
    }
    if (input.command !== undefined) {
      patch.command = yield* requireTrimmedNonEmpty(input.command, "action command", projectId);
    }
    if (input.icon !== undefined) {
      patch.icon = input.icon;
    }
    if (input.setup !== undefined) {
      patch.runOnWorktreeCreate = input.setup;
    }
    if (input.previewUrl !== undefined) {
      if (input.previewUrl === null) {
        clearPreviewUrl = true;
        clearAutoOpenPreview = true;
      } else {
        patch.previewUrl = yield* requireTrimmedNonEmpty(
          input.previewUrl,
          "preview URL",
          projectId,
        );
      }
    }
    if (input.autoOpenPreview !== undefined) {
      if (input.autoOpenPreview !== true) {
        clearAutoOpenPreview = true;
      } else {
        const nextPreviewUrl = clearPreviewUrl
          ? undefined
          : (patch.previewUrl ?? existing.previewUrl);
        if (nextPreviewUrl === undefined) {
          return yield* Effect.fail(
            new ProjectActionValidationError({
              message: "--auto-open-preview requires an existing or updated --preview-url",
              projectId,
            }),
          );
        }
        patch.autoOpenPreview = true;
      }
    }
    const updated: Mutable<ProjectScript> = {
      ...existing,
      ...patch,
    };
    if (clearPreviewUrl) {
      delete updated.previewUrl;
    }
    if (clearAutoOpenPreview) {
      delete updated.autoOpenPreview;
    }
    return updated;
  });
}
