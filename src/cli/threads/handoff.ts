import { tmpdir } from "node:os";

import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import { Command, Flag } from "effect/unstable/cli";

import { extraArgsConfig } from "../extra-args.ts";
import { asUserFlag, formatFlag, threadFlag } from "../flags.ts";
import {
  ConflictingUpdateFlagsError,
  MissingThreadError,
  MissingUpdateFieldsError,
} from "../error.ts";
import { resolveMessageAuthor, resolveThreadId } from "../scope/index.ts";
import { T3Application } from "../../application/service.ts";
import { CliPath } from "../../cli-path/service.ts";
import { CliRuntime } from "../../cli/runtime/service.ts";
import { loadT3CliEnv } from "../../config/env/env.ts";
import { resolveOutputFormat } from "../format/output.ts";
import { T3Output } from "../output/service.ts";

export const handoffThreadCommand = Command.make(
  "handoff",
  {
    thread: threadFlag,
    worktree: Flag.String("worktree").pipe(
      Flag.withDescription("Absolute path of the worktree to move the thread into"),
      Flag.optional,
    ),
    clearWorktree: Flag.Boolean("clear-worktree").pipe(
      Flag.withDescription("Move the thread back to the project root"),
      Flag.withDefault(false),
    ),
    branch: Flag.String("branch").pipe(
      Flag.withDescription("Branch checked out in the target worktree"),
      Flag.optional,
    ),
    clearBranch: Flag.Boolean("clear-branch").pipe(Flag.withDefault(false)),
    continuation: Flag.String("continue").pipe(
      Flag.withDescription("Message that starts the thread's next turn in the new worktree"),
      Flag.optional,
    ),
    foreground: Flag.Boolean("foreground").pipe(
      Flag.withDescription(
        "Run in this process even when handing off the calling thread (default: detach, since stopping the run ends the calling command)",
      ),
      Flag.withDefault(false),
    ),
    logFile: Flag.String("log-file").pipe(
      Flag.withDescription("Append progress to this file instead of printing it"),
      Flag.optional,
    ),
    asUser: asUserFlag,
    format: formatFlag,
    ...extraArgsConfig,
  },
  ({
    thread,
    worktree,
    clearWorktree,
    branch,
    clearBranch,
    continuation,
    foreground,
    logFile,
    asUser,
    format,
  }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      const cliRuntime = yield* CliRuntime;
      const t3CliEnv = yield* loadT3CliEnv;
      const output = yield* T3Output;
      const path = yield* Path.Path;
      const fileSystem = yield* FileSystem.FileSystem;
      const threadId = resolveThreadId({
        value: Option.getOrUndefined(thread),
        scope: t3CliEnv.scope,
      });
      if (threadId === undefined) {
        return yield* new MissingThreadError({
          message: "thread id is required: pass --thread or set T3CODE_THREAD_ID",
        });
      }

      const worktreeValue = Option.getOrUndefined(worktree);
      const branchValue = Option.getOrUndefined(branch);
      if (clearWorktree === (worktreeValue !== undefined)) {
        return yield* new ConflictingUpdateFlagsError({
          message: "pass exactly one of --worktree or --clear-worktree",
        });
      }
      if (clearBranch && branchValue !== undefined) {
        return yield* new ConflictingUpdateFlagsError({
          message: "--branch and --clear-branch are mutually exclusive",
        });
      }
      // The binding is stored verbatim and the server may run elsewhere, so the path is not
      // resolved against this process's cwd.
      if (worktreeValue !== undefined && !path.isAbsolute(worktreeValue)) {
        return yield* new ConflictingUpdateFlagsError({
          message: `--worktree must be an absolute path, got: ${worktreeValue}`,
        });
      }
      // Keeping the old branch would leave the thread pointing at the previous worktree's branch.
      if (worktreeValue !== undefined && branchValue === undefined && !clearBranch) {
        return yield* new MissingUpdateFieldsError({
          message: "--branch is required with --worktree: pass the branch checked out there",
        });
      }
      const prompt = Option.getOrUndefined(continuation);
      const resolvedFormat = resolveOutputFormat(format, cliRuntime, t3CliEnv, "json");

      const callerThreadId = t3CliEnv.scope.t3codeThreadId;
      if (!foreground && callerThreadId === threadId) {
        const cliPath = yield* CliPath;
        const spawner = yield* ChildProcessSpawner;
        const now = DateTime.toEpochMillis(yield* DateTime.now);
        const log =
          Option.getOrUndefined(logFile) ??
          path.join(tmpdir(), `t3cli-handoff-${threadId}-${now}.log`);
        const args = [
          cliPath.path,
          "thread",
          "handoff",
          "--thread",
          threadId,
          ...(worktreeValue !== undefined ? ["--worktree", worktreeValue] : ["--clear-worktree"]),
          ...(branchValue !== undefined ? ["--branch", branchValue] : []),
          ...(clearBranch ? ["--clear-branch"] : []),
          ...(prompt !== undefined ? ["--continue", prompt] : []),
          ...(asUser ? ["--as-user"] : []),
          "--foreground",
          "--log-file",
          log,
        ];
        // Detached into its own session: stopping the run kills the calling command's process
        // group, and the switch and continuation must outlive it.
        const handle = yield* spawner.spawn(
          ChildProcess.make(process.execPath, args, {
            detached: true,
            stdin: "ignore",
            stdout: "ignore",
            stderr: "ignore",
          }),
        );
        yield* handle.unref.pipe(Effect.ignore);
        if (resolvedFormat === "json") {
          return yield* output.printJson({ threadId, scheduled: true, pid: handle.pid, log });
        }
        return yield* output.printInfo(
          `handoff scheduled for ${threadId}: this run stops shortly; end the turn now (log: ${log})`,
        );
      }

      const logPath = Option.getOrUndefined(logFile);
      const report = (message: string) =>
        logPath === undefined
          ? resolvedFormat === "json"
            ? Effect.void
            : output.printInfo(message).pipe(Effect.ignore)
          : DateTime.now.pipe(
              Effect.flatMap((now) =>
                fileSystem.writeFileString(logPath, `${DateTime.formatIso(now)} ${message}\n`, {
                  flag: "a",
                }),
              ),
              Effect.ignore,
            );

      const result = yield* application
        .handoffThread({
          threadId,
          worktreePath: worktreeValue ?? null,
          ...(clearBranch
            ? { branch: null }
            : branchValue !== undefined
              ? { branch: branchValue }
              : {}),
          ...(prompt !== undefined ? { prompt } : {}),
          author: resolveMessageAuthor({ asUser, scope: t3CliEnv.scope, targetThreadId: threadId }),
          onStep: report,
        })
        .pipe(Effect.tapError((error) => report(`failed: ${error.message}`)));
      yield* report("done");
      if (resolvedFormat === "json") {
        return yield* output.printJson(result);
      }
      return yield* output.printInfo(
        `thread ${threadId} moved to ${result.worktreePath ?? "the project root"}`,
      );
    }),
).pipe(
  Command.withDescription(
    "stop the thread's run, switch its worktree, and continue there with a new message",
  ),
);
