import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import type {
  OrchestrationV2ThreadProjection,
  OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import { derivePendingThreadRequests } from "@t3tools/client-runtime/state/thread-requests";

import type { T3ApplicationService } from "../application/service.ts";
import type { T3CliEnvShape } from "../config/env/env.ts";
import { ThreadSessionError } from "../domain/error.ts";
import { isRunTerminal, runForUserMessage, threadLastError } from "../domain/thread-lifecycle.ts";
import { AskThreadArchivedError, AskThreadPendingRequestError } from "./error.ts";
import { formatWaitEventNdjson } from "./format/thread.ts";
import { isInteractiveHumanTerminal } from "./format/output.ts";
import { T3Output } from "./output/service.ts";
import { CliRuntime } from "./runtime/service.ts";

export const archivePolicyChoices = ["never", "always", "on-success", "on-failure"] as const;

export type ArchivePolicy = (typeof archivePolicyChoices)[number];
export type AskFormat = "human" | "json" | "ndjson";

export type AskArchiveResult =
  | {
      readonly policy: ArchivePolicy;
      readonly status: "skipped";
    }
  | {
      readonly policy: ArchivePolicy;
      readonly status: "archived";
      readonly sequence: number;
    }
  | {
      readonly policy: ArchivePolicy;
      readonly status: "failed";
      readonly error: string;
    };

export interface AskExecutionState {
  readonly archivePolicy: ArchivePolicy;
  threadId: string | undefined;
  createdThread: boolean;
  dispatched: boolean;
  askRunId: string | null;
  archiveResult: AskArchiveResult | undefined;
}

export function resolveAskFormat(
  format: "auto" | AskFormat,
  cliRuntime: CliRuntime["Service"],
  t3CliEnv: T3CliEnvShape,
): AskFormat {
  if (format !== "auto") {
    return format;
  }
  return isInteractiveHumanTerminal(cliRuntime, t3CliEnv) ? "human" : "json";
}

export function ensureAskTargetAvailable(thread: OrchestrationV2ThreadShell) {
  if (thread.archivedAt !== null) {
    return Effect.fail(
      new AskThreadArchivedError({
        message: `thread is archived: ${thread.id}`,
        threadId: thread.id,
      }),
    );
  }
  if (thread.pendingRuntimeRequest !== null) {
    return Effect.fail(
      new AskThreadPendingRequestError({
        message: `thread has a pending approval or user-input request: ${thread.id}`,
        threadId: thread.id,
      }),
    );
  }
  return Effect.void;
}

export function waitForAskThread(
  application: T3ApplicationService,
  output: T3Output["Service"],
  input: {
    readonly threadId: string;
    readonly format: AskFormat;
    readonly messageId: string;
    readonly state: AskExecutionState;
  },
) {
  let lastStatus = "";
  let runComplete = false;
  const observeAskThread = (projection: OrchestrationV2ThreadProjection) => {
    const observation = inspectAskRun(projection, input.messageId);
    input.state.askRunId = observation.runId;
    if (observation.status === "failed") {
      return Effect.fail(
        new ThreadSessionError({
          threadId: input.threadId,
          message: observation.message,
        }),
      );
    }
    runComplete = observation.status === "complete";
    if (runComplete) {
      return Effect.void;
    }
    const requests = derivePendingThreadRequests(projection);
    return ensureNoPendingRequest({
      id: input.threadId,
      hasPendingApprovals: requests.approvals.length > 0,
      hasPendingUserInput: requests.userInputs.length > 0,
    });
  };
  return Effect.gen(function* () {
    if (input.format === "human") {
      yield* output.writeStderr(`waiting for ${input.threadId}...\n`);
    }
    const last = yield* application.watchThread(input.threadId).pipe(
      Stream.tap((event) =>
        Effect.gen(function* () {
          if (event.type !== "message") {
            yield* observeAskThread(event.projection);
          }
          if (input.format === "ndjson") {
            yield* output.printNdjson(formatWaitEventNdjson(event));
            return;
          }
          if (input.format === "human" && event.type === "status" && event.status !== lastStatus) {
            lastStatus = event.status;
            yield* output.writeStderr(`${input.threadId}: ${event.status}\n`);
          }
        }),
      ),
      Stream.takeUntil((event) => runComplete || event.type === "done"),
      Stream.runLast,
    );
    const event = Option.getOrUndefined(last);
    if (!runComplete && event?.type !== "done") {
      return yield* Effect.fail(
        new ThreadSessionError({
          message: `thread wait ended without a terminal event: ${input.threadId}`,
          threadId: input.threadId,
        }),
      );
    }
    return yield* Effect.void;
  });
}

type AskRunObservation =
  | { readonly status: "waiting"; readonly runId: string | null }
  | { readonly status: "complete"; readonly runId: string }
  | { readonly status: "failed"; readonly runId: string; readonly message: string };

/** Follows the run the server created for the ask message. */
export function inspectAskRun(
  projection: OrchestrationV2ThreadProjection,
  messageId: string,
): AskRunObservation {
  const run = runForUserMessage(projection, messageId);
  if (run === undefined) {
    return { status: "waiting", runId: null };
  }
  if (run.status === "failed") {
    return {
      status: "failed",
      runId: run.id,
      message: threadLastError(projection) ?? "thread ended with error",
    };
  }
  return isRunTerminal(run)
    ? { status: "complete", runId: run.id }
    : { status: "waiting", runId: run.id };
}

export function finalizeArchive(
  application: T3ApplicationService,
  output: T3Output["Service"],
  state: AskExecutionState,
  succeeded: boolean,
): Effect.Effect<AskArchiveResult> {
  if (state.archiveResult !== undefined) {
    return Effect.succeed(state.archiveResult);
  }
  const shouldArchive =
    state.archivePolicy === "always" ||
    (state.archivePolicy === "on-success" && succeeded) ||
    (state.archivePolicy === "on-failure" && !succeeded);
  if (
    (!state.createdThread && !state.dispatched) ||
    state.threadId === undefined ||
    !shouldArchive
  ) {
    const result = {
      policy: state.archivePolicy,
      status: "skipped",
    } satisfies AskArchiveResult;
    state.archiveResult = result;
    return Effect.succeed(result);
  }
  const threadId = state.threadId;
  return application.archiveThread(threadId).pipe(
    Effect.matchEffect({
      onFailure: (error) =>
        Effect.gen(function* () {
          const result = {
            policy: state.archivePolicy,
            status: "failed",
            error: error.message,
          } satisfies AskArchiveResult;
          state.archiveResult = result;
          yield* output
            .writeStderr(`warning: failed to archive thread ${threadId}: ${error.message}\n`)
            .pipe(Effect.ignore);
          return result;
        }),
      onSuccess: (dispatch) => {
        const result = {
          policy: state.archivePolicy,
          status: "archived",
          sequence: dispatch.sequence,
        } satisfies AskArchiveResult;
        state.archiveResult = result;
        return Effect.succeed(result);
      },
    }),
  );
}

export function cleanupInterruptedAsk(
  application: T3ApplicationService,
  output: T3Output["Service"],
  state: AskExecutionState,
) {
  if (state.threadId === undefined) {
    return Effect.void;
  }
  const threadId = state.threadId;
  return Effect.gen(function* () {
    if (state.dispatched && state.askRunId !== null) {
      yield* application.interruptThreadRun(threadId, state.askRunId).pipe(
        Effect.matchEffect({
          onFailure: (error) =>
            output
              .writeStderr(`warning: failed to interrupt thread ${threadId}: ${error.message}\n`)
              .pipe(Effect.ignore),
          onSuccess: () => Effect.void,
        }),
      );
    }
    yield* finalizeArchive(application, output, state, false);
  }).pipe(Effect.asVoid);
}

export function ensureTrailingNewline(text: string) {
  return text.endsWith("\n") ? text : `${text}\n`;
}

function ensureNoPendingRequest(thread: {
  readonly id: string;
  readonly hasPendingApprovals: boolean;
  readonly hasPendingUserInput: boolean;
}) {
  if (!thread.hasPendingApprovals && !thread.hasPendingUserInput) {
    return Effect.void;
  }
  return Effect.fail(
    new AskThreadPendingRequestError({
      message: `thread requested approval or user input instead of answering: ${thread.id}`,
      threadId: thread.id,
    }),
  );
}
