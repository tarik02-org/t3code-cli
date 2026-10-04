import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Argument, Command, Flag } from "effect/unstable/cli";

import type { ApplicationError } from "../../application/error.ts";
import { T3Application, type DispatchResult } from "../../application/service.ts";
import { loadT3CliEnv } from "../../config/env/env.ts";
import { InvalidFlagCombinationError, MissingThreadError } from "../error.ts";
import { extraArgsConfig } from "../extra-args.ts";
import { formatFlag, selfActionForceFlag, threadFlag } from "../flags.ts";
import { formatQueuedRunsHuman } from "../format/thread.ts";
import { resolveOutputFormat, type HumanJsonFormat } from "../format/output.ts";
import { T3Input } from "../input/service.ts";
import { requireSelfActionConfirmation } from "../interaction/self-action.ts";
import { readInitialMessage } from "../message-input.ts";
import { T3Output } from "../output/service.ts";
import { CliRuntime } from "../runtime/service.ts";
import { resolveThreadId } from "../scope/index.ts";

const runIdArgument = Argument.String("run-id").pipe(
  Argument.withDescription("Queued run id from `thread queue list`"),
);

const requireThreadId = Effect.fn("requireQueueThreadId")(function* (
  thread: Option.Option<string>,
) {
  const t3CliEnv = yield* loadT3CliEnv;
  const threadId = resolveThreadId({ value: Option.getOrUndefined(thread), scope: t3CliEnv.scope });
  if (threadId === undefined) {
    return yield* new MissingThreadError({
      message: "thread id is required: pass --thread or set T3CODE_THREAD_ID",
    });
  }
  return threadId;
});

/** Shared shape of the queue mutations: resolve and confirm the thread, dispatch, report. */
const runQueueMutation = Effect.fn("runQueueMutation")(function* (input: {
  readonly thread: Option.Option<string>;
  readonly force: boolean;
  readonly format: HumanJsonFormat;
  readonly action: string;
  readonly done: string;
  readonly dispatch: (threadId: string) => Effect.Effect<DispatchResult, ApplicationError>;
}) {
  const cliRuntime = yield* CliRuntime;
  const t3CliEnv = yield* loadT3CliEnv;
  const output = yield* T3Output;
  const threadId = yield* requireThreadId(input.thread);
  yield* requireSelfActionConfirmation({
    threadId,
    force: input.force,
    cliRuntime,
    t3CliEnv,
    action: input.action,
  });
  const dispatch = yield* input.dispatch(threadId);
  if (resolveOutputFormat(input.format, cliRuntime, t3CliEnv, "json") === "json") {
    return yield* output.printJson({ threadId, dispatch });
  }
  return yield* output.printInfo(`${input.done} (sequence ${dispatch.sequence})`);
});

const listQueueCommand = Command.make(
  "list",
  { thread: threadFlag, format: formatFlag, ...extraArgsConfig },
  ({ thread, format }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      const cliRuntime = yield* CliRuntime;
      const t3CliEnv = yield* loadT3CliEnv;
      const output = yield* T3Output;
      const threadId = yield* requireThreadId(thread);
      const runs = yield* application.listQueuedRuns(threadId);
      if (resolveOutputFormat(format, cliRuntime, t3CliEnv, "json") === "json") {
        return yield* output.printJson({ threadId, runs });
      }
      return yield* output.writeStdout(formatQueuedRunsHuman(runs));
    }),
).pipe(Command.withDescription("list queued messages in start order"));

const cancelQueueCommand = Command.make(
  "cancel",
  {
    thread: threadFlag,
    force: selfActionForceFlag,
    run: runIdArgument,
    format: formatFlag,
    ...extraArgsConfig,
  },
  ({ thread, force, run, format }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      return yield* runQueueMutation({
        thread,
        force,
        format,
        action: "cancel a queued message in",
        done: `queued run cancelled: ${run}`,
        dispatch: (threadId) => application.cancelQueuedRun({ threadId, runId: run }),
      });
    }),
).pipe(Command.withDescription("cancel a queued message"));

const editQueueCommand = Command.make(
  "edit",
  {
    thread: threadFlag,
    force: selfActionForceFlag,
    run: runIdArgument,
    message: Argument.String("message").pipe(Argument.optional),
    stdin: Flag.Boolean("stdin").pipe(Flag.withDefault(false)),
    format: formatFlag,
    ...extraArgsConfig,
  },
  ({ thread, force, run, message, stdin, format }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      const inputService = yield* T3Input;
      const text = yield* readInitialMessage({
        message: Option.getOrUndefined(message),
        fromStdin: stdin,
        readStdin: inputService.readStdin,
      });
      return yield* runQueueMutation({
        thread,
        force,
        format,
        action: "edit a queued message in",
        done: `queued run edited: ${run}`,
        dispatch: (threadId) => application.editQueuedRun({ threadId, runId: run, text }),
      });
    }),
).pipe(Command.withDescription("replace the text of a queued message"));

const moveQueueCommand = Command.make(
  "move",
  {
    thread: threadFlag,
    force: selfActionForceFlag,
    run: runIdArgument,
    before: Flag.String("before").pipe(
      Flag.withDescription("Queued run id to move in front of"),
      Flag.optional,
    ),
    last: Flag.Boolean("last").pipe(
      Flag.withDescription("Move to the end of the queue"),
      Flag.withDefault(false),
    ),
    format: formatFlag,
    ...extraArgsConfig,
  },
  ({ thread, force, run, before, last, format }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      const beforeRunId = Option.getOrUndefined(before);
      if ((beforeRunId === undefined) === !last) {
        return yield* new InvalidFlagCombinationError({
          message: "pass exactly one of --before <run-id> or --last",
        });
      }
      return yield* runQueueMutation({
        thread,
        force,
        format,
        action: "reorder the queue of",
        done: `queued run moved: ${run}`,
        dispatch: (threadId) =>
          application.moveQueuedRun({ threadId, runId: run, beforeRunId: beforeRunId ?? null }),
      });
    }),
).pipe(Command.withDescription("reorder a queued message"));

const steerQueueCommand = Command.make(
  "steer",
  {
    thread: threadFlag,
    force: selfActionForceFlag,
    run: runIdArgument,
    format: formatFlag,
    ...extraArgsConfig,
  },
  ({ thread, force, run, format }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      return yield* runQueueMutation({
        thread,
        force,
        format,
        action: "steer the running run of",
        done: `queued run steered into the running run: ${run}`,
        dispatch: (threadId) => application.steerQueuedRun({ threadId, runId: run }),
      });
    }),
).pipe(Command.withDescription("deliver a queued message to the running run now"));

const resumeQueueCommand = Command.make(
  "resume",
  { thread: threadFlag, force: selfActionForceFlag, format: formatFlag, ...extraArgsConfig },
  ({ thread, force, format }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      return yield* runQueueMutation({
        thread,
        force,
        format,
        action: "resume the queue of",
        done: "queue resumed",
        dispatch: (threadId) => application.resumeQueue(threadId),
      });
    }),
).pipe(Command.withDescription("start queued messages held after a server restart"));

export const queueThreadCommand = Command.make("queue").pipe(
  Command.withDescription("manage messages queued behind a running run"),
  Command.withSubcommands([
    listQueueCommand,
    cancelQueueCommand,
    editQueueCommand,
    moveQueueCommand,
    steerQueueCommand,
    resumeQueueCommand,
  ]),
);
