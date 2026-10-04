import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { T3Application } from "../application/service.ts";
import { isThreadActive, runAnswer } from "../domain/thread-lifecycle.ts";
import { ThreadSessionError } from "../domain/error.ts";
import { loadT3CliEnv } from "../config/env/env.ts";
import {
  archivePolicyChoices,
  cleanupInterruptedAsk,
  ensureAskTargetAvailable,
  ensureTrailingNewline,
  finalizeArchive,
  inspectAskRun,
  resolveAskFormat,
  waitForAskThread,
} from "./ask-lifecycle.ts";
import type { AskExecutionState } from "./ask-lifecycle.ts";
import { extraArgsConfig } from "./extra-args.ts";
import {
  AskNoAnswerError,
  AskProjectMismatchError,
  AskThreadBusyError,
  AskTimeoutError,
  InvalidAskTimeoutError,
  InvalidFlagCombinationError,
} from "./error.ts";
import { humanJsonNdjsonFormatChoices } from "./format/output.ts";
import { asUserFlag, modelFlags, projectFlag, selfActionForceFlag, worktreeFlag } from "./flags.ts";
import { T3Input } from "./input/service.ts";
import { requireSelfActionConfirmation } from "./interaction/self-action.ts";
import { readInitialMessage } from "./message-input.ts";
import { buildModelOptions } from "./model-options.ts";
import { T3Output } from "./output/service.ts";
import { requireCommandProjectRef } from "./require.ts";
import { resolveMessageAuthor, resolveWorktreePath } from "./scope/index.ts";
import { CliRuntime } from "./runtime/service.ts";

interface AskResponse {
  readonly answer: string;
  readonly threadId: string;
  readonly runId: string;
  readonly created: boolean;
}

const askThreadFlag = Flag.String("thread").pipe(
  Flag.withDescription("Existing thread id; T3CODE_THREAD_ID is not used"),
  Flag.optional,
);

const archivePolicyFlag = Flag.Literals("archive", archivePolicyChoices).pipe(
  Flag.withDescription(
    "Archive policy (default: on-success for created threads, never for existing threads)",
  ),
  Flag.optional,
);

const timeoutFlag = Flag.String("timeout").pipe(
  Flag.withDescription("Response timeout, such as 30s, 5m, or 1h"),
  Flag.optional,
);

const askFormatFlag = Flag.Literals("format", humanJsonNdjsonFormatChoices).pipe(
  Flag.withDefault("human"),
);

export const askCommand = Command.make(
  "ask",
  {
    project: projectFlag,
    thread: askThreadFlag,
    force: selfActionForceFlag,
    message: Argument.String("message").pipe(Argument.optional),
    stdin: Flag.Boolean("stdin").pipe(Flag.withDefault(false)),
    title: Flag.String("title").pipe(Flag.optional),
    worktree: worktreeFlag,
    provider: Flag.String("provider").pipe(Flag.optional),
    model: Flag.String("model").pipe(Flag.optional),
    ...modelFlags,
    asUser: asUserFlag,
    archive: archivePolicyFlag,
    timeout: timeoutFlag,
    format: askFormatFlag,
    ...extraArgsConfig,
  },
  ({
    project,
    thread,
    force,
    message,
    stdin,
    title,
    worktree,
    provider,
    model,
    option,
    reasoningEffort,
    effort,
    fastMode,
    thinking,
    asUser,
    archive,
    timeout,
    format,
  }) =>
    Effect.gen(function* () {
      const explicitThreadId = Option.getOrUndefined(thread);
      const created = explicitThreadId === undefined;
      const titleValue = Option.getOrUndefined(title);
      const providerValue = Option.getOrUndefined(provider);
      const modelValue = Option.getOrUndefined(model);
      const createOnlyFlags = [
        Option.isSome(title) ? "--title" : null,
        Option.isSome(worktree) ? "--worktree" : null,
        Option.isSome(provider) ? "--provider" : null,
        Option.isSome(model) ? "--model" : null,
      ].filter((flag): flag is string => flag !== null);

      if (!created && createOnlyFlags.length > 0) {
        return yield* Effect.fail(
          new InvalidFlagCombinationError({
            message: `${createOnlyFlags.join(", ")} cannot be used with --thread`,
          }),
        );
      }
      if (created && force) {
        return yield* Effect.fail(
          new InvalidFlagCombinationError({
            message: "--force can only be used with --thread",
          }),
        );
      }

      const timeoutValue = Option.getOrUndefined(timeout);
      const timeoutDuration =
        timeoutValue === undefined ? undefined : yield* parseAskTimeout(timeoutValue);
      const archivePolicy = Option.getOrElse(archive, () => (created ? "on-success" : "never"));
      const application = yield* T3Application;
      const cliRuntime = yield* CliRuntime;
      const t3CliEnv = yield* loadT3CliEnv;
      const input = yield* T3Input;
      const output = yield* T3Output;
      const resolvedFormat = resolveAskFormat(format, cliRuntime, t3CliEnv);
      const options = buildModelOptions({
        option,
        reasoningEffort,
        effort,
        fastMode,
        thinking,
      });
      const state: AskExecutionState = {
        archivePolicy,
        threadId: explicitThreadId,
        createdThread: false,
        dispatched: false,
        askRunId: null,
        archiveResult: undefined,
      };

      const response = Effect.gen(function* () {
        const text = yield* readInitialMessage({
          message: Option.getOrUndefined(message),
          fromStdin: stdin,
          readStdin: input.readStdin,
        });
        let askMessageId: string;

        if (explicitThreadId === undefined) {
          const projectRef = yield* requireCommandProjectRef({ project });
          const resolvedProject = yield* application.resolveProject(projectRef);
          const worktreePath = resolveWorktreePath({
            value: Option.getOrUndefined(worktree),
            scope: t3CliEnv.scope,
          });
          const result = yield* application.startThread(
            {
              message: text,
              projectRef: resolvedProject.id,
              ...(titleValue !== undefined ? { title: titleValue } : {}),
              ...(worktreePath !== undefined ? { worktreePath } : {}),
              ...(providerValue !== undefined ? { provider: providerValue } : {}),
              ...(modelValue !== undefined ? { model: modelValue } : {}),
              ...(options.length > 0 ? { options } : {}),
            },
            {
              until: "dispatch",
              onThreadCreated: (threadId) =>
                Effect.sync(() => {
                  state.threadId = threadId;
                  state.createdThread = true;
                }),
            },
          );
          state.dispatched = true;
          askMessageId = result.messageId;
        } else {
          const summary = yield* application.getThreadSummary(explicitThreadId);
          yield* ensureAskTargetAvailable(summary);

          const projectRef = Option.getOrUndefined(project);
          if (projectRef !== undefined) {
            const resolvedProject = yield* application.resolveProject(projectRef);
            if (summary.projectId !== resolvedProject.id) {
              return yield* Effect.fail(
                new AskProjectMismatchError({
                  message: `thread ${explicitThreadId} belongs to project ${summary.projectId}, not ${resolvedProject.id}`,
                  threadId: explicitThreadId,
                  projectId: resolvedProject.id,
                }),
              );
            }
          }

          yield* requireSelfActionConfirmation({
            threadId: explicitThreadId,
            force,
            cliRuntime,
            t3CliEnv,
            action: "ask",
          });

          if (isThreadActive(yield* application.getThreadProjection(explicitThreadId))) {
            return yield* Effect.fail(
              new AskThreadBusyError({
                message: `thread is busy: ${explicitThreadId}`,
                threadId: explicitThreadId,
              }),
            );
          }

          const result = yield* application.sendThread(
            {
              threadId: explicitThreadId,
              message: text,
              author: resolveMessageAuthor({
                asUser,
                scope: t3CliEnv.scope,
                targetThreadId: explicitThreadId,
              }),
              ...(options.length > 0 ? { options } : {}),
            },
            { until: "dispatch" },
          );
          state.dispatched = true;
          askMessageId = result.messageId;
          yield* application.awaitShellSequence(result.dispatch.sequence);
        }

        const threadId = state.threadId;
        if (threadId === undefined) {
          return yield* Effect.fail(
            new AskNoAnswerError({
              message: "ask did not resolve a thread id",
              threadId: "unknown",
            }),
          );
        }

        if (resolvedFormat === "ndjson") {
          yield* output.printNdjson({ type: "dispatched", threadId, messageId: askMessageId });
        }
        yield* waitForAskThread(application, output, {
          threadId,
          format: resolvedFormat,
          messageId: askMessageId,
          state,
        });

        const finalProjection = yield* application.getThreadProjection(threadId);
        const observation = inspectAskRun(finalProjection, askMessageId);
        if (observation.status === "failed") {
          return yield* Effect.fail(
            new ThreadSessionError({
              threadId,
              message: observation.message,
            }),
          );
        }
        const answer =
          observation.status === "complete"
            ? runAnswer(finalProjection, observation.runId)
            : undefined;
        if (observation.status !== "complete" || answer === undefined) {
          return yield* Effect.fail(
            new AskNoAnswerError({
              message: `thread completed without a new final answer: ${threadId}`,
              threadId,
            }),
          );
        }
        return {
          answer: answer.text,
          threadId,
          runId: observation.runId,
          created,
        } satisfies AskResponse;
      });

      const responseWithCleanup = response.pipe(
        Effect.onInterrupt(() => cleanupInterruptedAsk(application, output, state)),
      );
      const timedResponse =
        timeoutDuration === undefined
          ? responseWithCleanup
          : responseWithCleanup.pipe(
              Effect.timeoutOrElse({
                duration: timeoutDuration,
                orElse: () =>
                  Effect.fail(
                    new AskTimeoutError({
                      message: `ask timed out after ${timeoutValue ?? Duration.format(timeoutDuration)}`,
                      timeout: timeoutValue ?? Duration.format(timeoutDuration),
                    }),
                  ),
              }),
            );

      return yield* timedResponse.pipe(
        Effect.matchEffect({
          onFailure: (error) =>
            finalizeArchive(application, output, state, false).pipe(
              Effect.flatMap(() => Effect.fail(error)),
            ),
          onSuccess: (result) =>
            Effect.gen(function* () {
              const archiveResult = yield* finalizeArchive(application, output, state, true);
              const formatted = {
                answer: result.answer,
                threadId: result.threadId,
                runId: result.runId,
                created: result.created,
                archive: archiveResult,
              };
              if (resolvedFormat === "json") {
                return yield* output.printJson(formatted);
              }
              if (resolvedFormat === "ndjson") {
                return yield* output.printNdjson({ type: "result", ...formatted });
              }
              return yield* output.writeStdout(ensureTrailingNewline(result.answer));
            }),
        }),
      );
    }),
).pipe(Command.withDescription("ask a project or existing thread and wait for one answer"));

function parseAskTimeout(value: string) {
  const trimmed = value.trim();
  const shorthand = /^([0-9]+(?:\.[0-9]+)?)(ms|s|m|h|d|w)$/.exec(trimmed);
  let input = trimmed;
  if (shorthand !== null) {
    const amount = shorthand[1];
    const unit = shorthand[2];
    const units: Readonly<Record<string, string>> = {
      ms: "millis",
      s: "seconds",
      m: "minutes",
      h: "hours",
      d: "days",
      w: "weeks",
    };
    const expandedUnit = unit === undefined ? undefined : units[unit];
    if (amount !== undefined && expandedUnit !== undefined) {
      input = `${amount} ${expandedUnit}`;
    }
  }
  const parsed = Schema.decodeUnknownOption(Schema.DurationFromString)(input);
  if (Option.isNone(parsed)) {
    return Effect.fail(
      new InvalidAskTimeoutError({
        message: `invalid timeout: ${value}`,
        value,
      }),
    );
  }
  const millis = Duration.toMillis(parsed.value);
  if (!Number.isFinite(millis) || millis <= 0) {
    return Effect.fail(
      new InvalidAskTimeoutError({
        message: `timeout must be a positive finite duration: ${value}`,
        value,
      }),
    );
  }
  return Effect.succeed(parsed.value);
}
