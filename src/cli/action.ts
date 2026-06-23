import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Command, Flag } from "effect/unstable/cli";

import type { ProjectActionSelector } from "../application/actions.ts";
import { T3Application } from "../application/service.ts";
import { loadT3CliEnv } from "../config/env/env.ts";
import {
  formatActionAddedHuman,
  formatActionDeletedHuman,
  formatActionListHuman,
  formatActionRunHuman,
  formatActionUpdatedHuman,
} from "./action-format.ts";
import {
  ConflictingUpdateFlagsError,
  InvalidFlagCombinationError,
  MissingUpdateFieldsError,
} from "./error.ts";
import { formatFlag, projectFlag, threadFlag, yesFlag } from "./flags.ts";
import { resolveOutputFormat } from "./format/output.ts";
import { requireDestructiveConfirmation } from "./interaction/confirm.ts";
import { T3Output } from "./output/service.ts";
import { requireCommandProjectRef } from "./require.ts";
import { CliRuntime } from "./runtime/service.ts";
import { requireCommandThreadId } from "./terminal/scope.ts";
import { runAttachedTerminalSession, snapshotToTerminalAttachTarget } from "./terminal/shared.ts";

const actionIconChoices = ["play", "test", "lint", "configure", "build", "debug"] as const;

export function createActionCommand() {
  return Command.make("action").pipe(
    Command.withDescription("project-defined toolbar action commands"),
    Command.withSubcommands([
      listActionsCommand,
      runActionCommand,
      addActionCommand,
      updateActionCommand,
      deleteActionCommand,
    ]),
  );
}

const idFlag = Flag.string("id").pipe(Flag.optional);
const nameFlag = Flag.string("name").pipe(Flag.optional);
const commandFlag = Flag.string("command");
const optionalCommandFlag = Flag.string("command").pipe(Flag.optional);
const iconFlag = Flag.choice("icon", actionIconChoices).pipe(Flag.withDefault("play"));
const optionalIconFlag = Flag.choice("icon", actionIconChoices).pipe(Flag.optional);
const setupFlag = Flag.boolean("setup");
const optionalSetupFlag = Flag.boolean("setup").pipe(Flag.optional);
const noSetupFlag = Flag.boolean("no-setup").pipe(Flag.optional);
const previewUrlFlag = Flag.string("preview-url").pipe(Flag.optional);
const clearPreviewUrlFlag = Flag.boolean("clear-preview-url").pipe(Flag.optional);
const autoOpenPreviewFlag = Flag.boolean("auto-open-preview").pipe(Flag.optional);
const noAutoOpenPreviewFlag = Flag.boolean("no-auto-open-preview").pipe(Flag.optional);
const clearAutoOpenPreviewFlag = Flag.boolean("clear-auto-open-preview").pipe(Flag.optional);

const listActionsCommand = Command.make(
  "list",
  {
    project: projectFlag,
    format: formatFlag,
  },
  ({ project, format }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      const cliRuntime = yield* CliRuntime;
      const t3CliEnv = yield* loadT3CliEnv;
      const output = yield* T3Output;
      const projectRef = yield* requireCommandProjectRef({
        project,
      });
      const result = yield* application.listActions(projectRef);
      const resolvedFormat = resolveOutputFormat(format, cliRuntime, t3CliEnv, "json");
      if (resolvedFormat === "json") {
        yield* output.printJson(result);
      } else {
        yield* output.writeStdout(formatActionListHuman(result));
      }
    }),
).pipe(Command.withDescription("list project actions"));

const runActionCommand = Command.make(
  "run",
  {
    thread: threadFlag,
    id: idFlag,
    name: nameFlag,
    terminal: Flag.string("terminal").pipe(Flag.optional),
    attach: Flag.boolean("attach"),
    format: formatFlag,
  },
  ({ thread, id, name, terminal, attach, format }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      const cliRuntime = yield* CliRuntime;
      const t3CliEnv = yield* loadT3CliEnv;
      const output = yield* T3Output;
      const threadId = yield* requireCommandThreadId({
        thread,
      });
      const selector = yield* requireActionSelector({ id, name });
      const terminalId = Option.getOrUndefined(terminal);
      const result = yield* application.runAction({
        threadId,
        selector,
        ...(terminalId !== undefined ? { terminalId } : {}),
      });

      if (attach) {
        yield* runAttachedTerminalSession({
          terminal: snapshotToTerminalAttachTarget(result.terminal),
        });
      } else {
        const resolvedFormat = resolveOutputFormat(format, cliRuntime, t3CliEnv, "json");
        if (resolvedFormat === "json") {
          yield* output.printJson(result);
        } else {
          yield* output.printInfo(formatActionRunHuman(result));
        }
      }
    }),
).pipe(Command.withDescription("run a project action in a thread terminal"));

const addActionCommand = Command.make(
  "add",
  {
    project: projectFlag,
    name: Flag.string("name"),
    command: commandFlag,
    id: idFlag,
    icon: iconFlag,
    setup: setupFlag,
    previewUrl: previewUrlFlag,
    autoOpenPreview: Flag.boolean("auto-open-preview"),
    format: formatFlag,
  },
  ({ project, name, command, id, icon, setup, previewUrl, autoOpenPreview, format }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      const cliRuntime = yield* CliRuntime;
      const t3CliEnv = yield* loadT3CliEnv;
      const output = yield* T3Output;
      const projectRef = yield* requireCommandProjectRef({
        project,
      });
      const idValue = Option.getOrUndefined(id);
      const previewUrlValue = Option.getOrUndefined(previewUrl);
      const result = yield* application.addAction({
        projectRef,
        name,
        command,
        icon,
        ...(idValue !== undefined ? { id: idValue } : {}),
        ...(setup ? { setup: true } : {}),
        ...(previewUrlValue !== undefined ? { previewUrl: previewUrlValue } : {}),
        ...(autoOpenPreview ? { autoOpenPreview: true } : {}),
      });
      const resolvedFormat = resolveOutputFormat(format, cliRuntime, t3CliEnv, "json");
      if (resolvedFormat === "json") {
        yield* output.printJson(result);
      } else {
        yield* output.printInfo(
          formatActionAddedHuman({
            project: result.project,
            action: result.action,
            sequence: result.dispatch.sequence,
          }),
        );
      }
    }),
).pipe(Command.withDescription("add a project action"));

const updateActionCommand = Command.make(
  "update",
  {
    project: projectFlag,
    id: idFlag,
    name: nameFlag,
    setName: Flag.string("set-name").pipe(Flag.optional),
    command: optionalCommandFlag,
    icon: optionalIconFlag,
    setup: optionalSetupFlag,
    noSetup: noSetupFlag,
    previewUrl: previewUrlFlag,
    clearPreviewUrl: clearPreviewUrlFlag,
    autoOpenPreview: autoOpenPreviewFlag,
    noAutoOpenPreview: noAutoOpenPreviewFlag,
    clearAutoOpenPreview: clearAutoOpenPreviewFlag,
    format: formatFlag,
  },
  ({
    project,
    id,
    name,
    setName,
    command,
    icon,
    setup,
    noSetup,
    previewUrl,
    clearPreviewUrl,
    autoOpenPreview,
    noAutoOpenPreview,
    clearAutoOpenPreview,
    format,
  }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      const cliRuntime = yield* CliRuntime;
      const t3CliEnv = yield* loadT3CliEnv;
      const output = yield* T3Output;
      const projectRef = yield* requireCommandProjectRef({
        project,
      });
      const selector = yield* requireActionSelector({ id, name });
      const patch = yield* buildUpdatePatch({
        setName,
        command,
        icon,
        setup,
        noSetup,
        previewUrl,
        clearPreviewUrl,
        autoOpenPreview,
        noAutoOpenPreview,
        clearAutoOpenPreview,
      });
      const result = yield* application.updateAction({
        projectRef,
        selector,
        ...patch,
      });
      const resolvedFormat = resolveOutputFormat(format, cliRuntime, t3CliEnv, "json");
      if (resolvedFormat === "json") {
        yield* output.printJson(result);
      } else {
        yield* output.printInfo(
          formatActionUpdatedHuman({
            project: result.project,
            action: result.action,
            sequence: result.dispatch.sequence,
          }),
        );
      }
    }),
).pipe(Command.withDescription("update a project action"));

const deleteActionCommand = Command.make(
  "delete",
  {
    project: projectFlag,
    id: idFlag,
    name: nameFlag,
    yes: yesFlag,
    format: formatFlag,
  },
  ({ project, id, name, yes, format }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      const cliRuntime = yield* CliRuntime;
      const t3CliEnv = yield* loadT3CliEnv;
      const output = yield* T3Output;
      const projectRef = yield* requireCommandProjectRef({
        project,
      });
      const selector = yield* requireActionSelector({ id, name });
      const listed = yield* application.listActions(projectRef);
      const selectorLabel =
        selector.id !== undefined ? `id ${selector.id}` : `name ${selector.name.trim()}`;
      yield* requireDestructiveConfirmation({
        message: `Delete action selected by ${selectorLabel} from ${listed.project.title}?`,
        yes,
        cliRuntime,
        t3CliEnv,
      });
      const result = yield* application.deleteAction({
        projectRef,
        selector,
      });
      const resolvedFormat = resolveOutputFormat(format, cliRuntime, t3CliEnv, "json");
      if (resolvedFormat === "json") {
        yield* output.printJson(result);
      } else {
        yield* output.printInfo(
          formatActionDeletedHuman({
            project: result.project,
            action: result.action,
            sequence: result.dispatch.sequence,
          }),
        );
      }
    }),
).pipe(Command.withDescription("delete a project action"));

function requireActionSelector(input: {
  readonly id: Option.Option<string>;
  readonly name: Option.Option<string>;
}) {
  return Effect.gen(function* () {
    const id = Option.getOrUndefined(input.id);
    const name = Option.getOrUndefined(input.name);
    if ((id === undefined && name === undefined) || (id !== undefined && name !== undefined)) {
      return yield* Effect.fail(
        new InvalidFlagCombinationError({
          message: "provide exactly one action selector: --id <id> or --name <name>",
        }),
      );
    }
    return id !== undefined
      ? ({ id } satisfies ProjectActionSelector)
      : ({ name: name! } satisfies ProjectActionSelector);
  });
}

function buildUpdatePatch(input: {
  readonly setName: Option.Option<string>;
  readonly command: Option.Option<string>;
  readonly icon: Option.Option<(typeof actionIconChoices)[number]>;
  readonly setup: Option.Option<boolean>;
  readonly noSetup: Option.Option<boolean>;
  readonly previewUrl: Option.Option<string>;
  readonly clearPreviewUrl: Option.Option<boolean>;
  readonly autoOpenPreview: Option.Option<boolean>;
  readonly noAutoOpenPreview: Option.Option<boolean>;
  readonly clearAutoOpenPreview: Option.Option<boolean>;
}) {
  return Effect.gen(function* () {
    const setName = Option.getOrUndefined(input.setName);
    const command = Option.getOrUndefined(input.command);
    const icon = Option.getOrUndefined(input.icon);
    const setup = Option.getOrUndefined(input.setup);
    const noSetup = Option.getOrUndefined(input.noSetup);
    const previewUrl = Option.getOrUndefined(input.previewUrl);
    const clearPreviewUrl = Option.getOrUndefined(input.clearPreviewUrl);
    const autoOpenPreview = Option.getOrUndefined(input.autoOpenPreview);
    const noAutoOpenPreview = Option.getOrUndefined(input.noAutoOpenPreview);
    const clearAutoOpenPreview = Option.getOrUndefined(input.clearAutoOpenPreview);

    if (setup === true && noSetup === true) {
      return yield* Effect.fail(
        new ConflictingUpdateFlagsError({
          message: "--setup and --no-setup are mutually exclusive",
        }),
      );
    }
    if (previewUrl !== undefined && clearPreviewUrl === true) {
      return yield* Effect.fail(
        new ConflictingUpdateFlagsError({
          message: "--preview-url and --clear-preview-url are mutually exclusive",
        }),
      );
    }
    const autoOpenSetCount = [autoOpenPreview, noAutoOpenPreview, clearAutoOpenPreview].filter(
      (value) => value === true,
    ).length;
    if (autoOpenSetCount > 1) {
      return yield* Effect.fail(
        new ConflictingUpdateFlagsError({
          message:
            "--auto-open-preview, --no-auto-open-preview, and --clear-auto-open-preview are mutually exclusive",
        }),
      );
    }

    const patch = {
      ...(setName !== undefined ? { name: setName } : {}),
      ...(command !== undefined ? { command } : {}),
      ...(icon !== undefined ? { icon } : {}),
      ...(setup === true ? { setup: true } : noSetup === true ? { setup: false } : {}),
      ...(clearPreviewUrl === true
        ? { previewUrl: null }
        : previewUrl !== undefined
          ? { previewUrl }
          : {}),
      ...(autoOpenPreview === true
        ? { autoOpenPreview: true }
        : noAutoOpenPreview === true || clearAutoOpenPreview === true
          ? { autoOpenPreview: null }
          : {}),
    };
    if (Object.keys(patch).length === 0) {
      return yield* Effect.fail(
        new MissingUpdateFieldsError({
          message:
            "at least one update field is required: --set-name, --command, --icon, --setup, --no-setup, --preview-url, --clear-preview-url, --auto-open-preview, --no-auto-open-preview, or --clear-auto-open-preview",
        }),
      );
    }
    return patch;
  });
}
