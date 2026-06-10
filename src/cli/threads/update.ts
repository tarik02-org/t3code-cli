import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Command, Flag } from "effect/unstable/cli";

import { formatFlag, modelFlags, threadFlag } from "../flags.ts";
import {
  ConflictingUpdateFlagsError,
  MissingThreadError,
  MissingUpdateFieldsError,
} from "../error.ts";
import { buildModelOptions } from "../model-options.ts";
import { resolveThreadId } from "../../scope/index.ts";
import { T3Application } from "../../application/service.ts";
import { Environment } from "../../environment/service.ts";
import { resolveOutputFormat } from "../output-format.ts";
import { T3Output } from "../output/service.ts";

export const updateThreadCommand = Command.make(
  "update",
  {
    thread: threadFlag,
    title: Flag.string("title").pipe(Flag.optional),
    provider: Flag.string("provider").pipe(Flag.optional),
    model: Flag.string("model").pipe(Flag.optional),
    ...modelFlags,
    branch: Flag.string("branch").pipe(Flag.optional),
    clearBranch: Flag.boolean("clear-branch").pipe(Flag.optional),
    worktree: Flag.string("worktree").pipe(Flag.optional),
    clearWorktree: Flag.boolean("clear-worktree").pipe(Flag.optional),
    format: formatFlag,
  },
  ({
    thread,
    title,
    provider,
    model,
    option,
    reasoningEffort,
    effort,
    fastMode,
    thinking,
    branch,
    clearBranch,
    worktree,
    clearWorktree,
    format,
  }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      const environment = yield* Environment;
      const output = yield* T3Output;
      const threadId = resolveThreadId({
        value: Option.getOrUndefined(thread),
        env: environment.env,
      });
      if (threadId === undefined) {
        return yield* Effect.fail(
          new MissingThreadError({
            message: "thread id is required: pass --thread or set T3CODE_THREAD_ID",
          }),
        );
      }

      const titleValue = Option.getOrUndefined(title);
      const providerValue = Option.getOrUndefined(provider);
      const modelValue = Option.getOrUndefined(model);
      const branchValue = Option.getOrUndefined(branch);
      const worktreeValue = Option.getOrUndefined(worktree);
      const clearBranchValue = Option.getOrUndefined(clearBranch);
      const clearWorktreeValue = Option.getOrUndefined(clearWorktree);
      const options = buildModelOptions({
        option,
        reasoningEffort,
        effort,
        fastMode,
        thinking,
      });

      if (clearBranchValue === true && branchValue !== undefined) {
        return yield* Effect.fail(
          new ConflictingUpdateFlagsError({
            message: "--branch and --clear-branch are mutually exclusive",
          }),
        );
      }
      if (clearWorktreeValue === true && worktreeValue !== undefined) {
        return yield* Effect.fail(
          new ConflictingUpdateFlagsError({
            message: "--worktree and --clear-worktree are mutually exclusive",
          }),
        );
      }

      const hasTitle = titleValue !== undefined && titleValue.length > 0;
      const hasProvider = providerValue !== undefined && providerValue.length > 0;
      const hasModel = modelValue !== undefined && modelValue.length > 0;
      const hasBranch = branchValue !== undefined && branchValue.length > 0;
      const hasWorktree = worktreeValue !== undefined && worktreeValue.length > 0;
      if (
        !hasTitle &&
        !hasProvider &&
        !hasModel &&
        options.length === 0 &&
        !hasBranch &&
        clearBranchValue !== true &&
        !hasWorktree &&
        clearWorktreeValue !== true
      ) {
        return yield* Effect.fail(
          new MissingUpdateFieldsError({
            message:
              "at least one update field is required: --title, model flags, --branch, --clear-branch, --worktree, or --clear-worktree",
          }),
        );
      }

      const dispatch = yield* application.updateThread({
        threadId,
        ...(hasTitle ? { title: titleValue } : {}),
        ...(hasProvider ? { provider: providerValue } : {}),
        ...(hasModel ? { model: modelValue } : {}),
        ...(options.length > 0 ? { options } : {}),
        ...(clearBranchValue === true
          ? { branch: null }
          : hasBranch
            ? { branch: branchValue }
            : {}),
        ...(clearWorktreeValue === true
          ? { worktreePath: null }
          : hasWorktree
            ? { worktreePath: worktreeValue }
            : {}),
      });
      const resolvedFormat = resolveOutputFormat(format, environment, "json");
      if (resolvedFormat === "json") {
        return yield* output.printJson(dispatch);
      }
      return yield* output.printInfo(`thread updated: ${threadId}\nsequence: ${dispatch.sequence}`);
    }),
).pipe(Command.withDescription("update thread metadata"));
