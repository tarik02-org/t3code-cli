import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Stream from "effect/Stream";
import type {
  TerminalAttachStreamEvent,
  TerminalSessionSnapshot,
  TerminalSummary,
} from "#t3tools/contracts";

import type { TerminalAttachTarget, TerminalRef } from "../../application/service.ts";
import { T3Application } from "../../application/service.ts";
import type { ApplicationError } from "../../application/error.ts";
import { TerminalCliError, type TerminalIoError } from "./error.ts";
import { TerminalIo } from "./io-service.ts";

const DETACH_BYTE = 0x1d;
const ANSI_CLEAR_SCREEN = "\u001bc";

type AttachSessionResult =
  | {
      readonly _tag: "Failure";
      readonly error: ApplicationError | TerminalCliError;
      readonly message?: string;
    }
  | {
      readonly _tag: "Success";
      readonly message?: string;
    };

export function runAttachedTerminalSession(input: { readonly terminal: TerminalAttachTarget }) {
  return Effect.scoped(
    Effect.gen(function* () {
      const application = yield* T3Application;
      const io = yield* TerminalIo;
      const { cols, rows } = yield* io.getWindowSize.pipe(
        Effect.mapError((error) => mapTerminalIoError(error, input.terminal)),
      );
      const session = yield* io.openRawSession.pipe(
        Effect.mapError((error) => mapTerminalIoError(error, input.terminal)),
      );
      const completion = yield* Deferred.make<AttachSessionResult>();
      const stream = application.attachTerminal({
        terminal: input.terminal,
        cols,
        rows,
      });

      yield* Stream.runForEach(stream, applyAttachEvent).pipe(
        Effect.match({
          onFailure: (error) => completeAttachSession(completion, { _tag: "Failure", error }),
          onSuccess: () => completeAttachSession(completion, { _tag: "Success" }),
        }),
        Effect.forkScoped,
      );

      yield* Stream.runForEach(session.resize, ({ cols: nextCols, rows: nextRows }) =>
        application.resizeTerminal({
          terminal: input.terminal,
          cols: nextCols,
          rows: nextRows,
        }),
      ).pipe(
        Effect.match({
          onFailure: (error) => completeAttachSession(completion, { _tag: "Failure", error }),
          onSuccess: () => completeAttachSession(completion, { _tag: "Success" }),
        }),
        Effect.forkScoped,
      );

      yield* Stream.runForEach(session.input, (chunk) =>
        handleSessionInput({
          completion,
          terminal: input.terminal,
          chunk,
        }),
      ).pipe(
        Effect.match({
          onFailure: (error) => completeAttachSession(completion, { _tag: "Failure", error }),
          onSuccess: () => completeAttachSession(completion, { _tag: "Success" }),
        }),
        Effect.forkScoped,
      );

      const result = yield* Deferred.await(completion);
      if (result.message !== undefined) {
        yield* writeSystemMessage(result.message);
      }
      return yield* Match.value(result).pipe(
        Match.tag("Failure", ({ error }) => Effect.fail(error)),
        Match.orElse(() => Effect.void),
      );
    }),
  );
}

function completeAttachSession(
  completion: Deferred.Deferred<AttachSessionResult>,
  result: AttachSessionResult,
) {
  return Deferred.succeed(completion, result).pipe(Effect.ignore);
}

function handleSessionInput(input: {
  readonly completion: Deferred.Deferred<AttachSessionResult>;
  readonly terminal: TerminalRef;
  readonly chunk: Uint8Array;
}) {
  const detachOffset = input.chunk.indexOf(DETACH_BYTE);
  const payload = detachOffset === -1 ? input.chunk : input.chunk.slice(0, detachOffset);

  if (payload.length === 0 && detachOffset === -1) {
    return Effect.void;
  }

  return Effect.gen(function* () {
    const application = yield* T3Application;
    if (payload.length > 0) {
      yield* application.writeTerminal({
        terminal: input.terminal,
        data: Buffer.from(payload).toString("utf8"),
      });
    }

    if (detachOffset !== -1) {
      yield* completeAttachSession(input.completion, {
        _tag: "Success",
        message: "detached",
      });
    }
  });
}

function mapTerminalIoError(
  error: TerminalIoError,
  terminal: TerminalAttachTarget,
): TerminalCliError {
  return new TerminalCliError({
    message: error.message,
    threadId: terminal.threadId,
    terminalId: terminal.terminalId,
  });
}

function applyAttachEvent(event: TerminalAttachStreamEvent) {
  return Effect.gen(function* () {
    const io = yield* TerminalIo;
    yield* Match.value(event).pipe(
      Match.when({ type: "activity" }, () => Effect.void),
      Match.when({ type: "snapshot" }, ({ snapshot }) => writeSnapshot(snapshot.history)),
      Match.when({ type: "restarted" }, ({ snapshot }) => writeSnapshot(snapshot.history)),
      Match.when({ type: "output" }, ({ data }) => io.writeOutput(data)),
      Match.when({ type: "cleared" }, () => io.writeOutput(ANSI_CLEAR_SCREEN)),
      Match.when({ type: "error" }, ({ message }) => writeSystemMessage(message)),
      Match.when({ type: "closed" }, () => writeSystemMessage("Terminal closed")),
      Match.orElse((next) => {
        const details = [
          typeof next.exitCode === "number" ? `code ${next.exitCode}` : null,
          typeof next.exitSignal === "number" ? `signal ${next.exitSignal}` : null,
        ]
          .filter((value): value is string => value !== null)
          .join(", ");
        return writeSystemMessage(
          details.length > 0 ? `Process exited (${details})` : "Process exited",
        );
      }),
    );
  });
}

function writeSnapshot(history: string) {
  return Effect.gen(function* () {
    const io = yield* TerminalIo;
    yield* io.writeOutput(ANSI_CLEAR_SCREEN);
    if (history.length > 0) {
      yield* io.writeOutput(history);
    }
  });
}

function writeSystemMessage(message: string) {
  return Effect.gen(function* () {
    const io = yield* TerminalIo;
    yield* io.writeOutput(`\r\n[terminal] ${message}\r\n`);
  });
}

export function toTerminalAttachTarget(terminal: TerminalSummary): TerminalAttachTarget {
  return {
    threadId: terminal.threadId,
    terminalId: terminal.terminalId,
    cwd: terminal.cwd,
    worktreePath: terminal.worktreePath,
  };
}

export function snapshotToTerminalAttachTarget(
  snapshot: TerminalSessionSnapshot,
): TerminalAttachTarget {
  return {
    threadId: snapshot.threadId,
    terminalId: snapshot.terminalId,
    cwd: snapshot.cwd,
    worktreePath: snapshot.worktreePath,
  };
}

export function toTerminalRef(terminal: TerminalSummary): TerminalRef {
  return {
    threadId: terminal.threadId,
    terminalId: terminal.terminalId,
  };
}

export function filterAttachStreamEvent(
  event: TerminalAttachStreamEvent,
  options: {
    readonly includeHistory: boolean;
    readonly fromSequence?: number;
  },
): TerminalAttachStreamEvent | null {
  if (event.type === "snapshot" || event.type === "restarted") {
    return {
      ...event,
      snapshot: {
        ...event.snapshot,
        history:
          options.includeHistory && options.fromSequence === undefined
            ? event.snapshot.history
            : "",
      },
    };
  }

  if (
    options.fromSequence !== undefined &&
    typeof event.sequence === "number" &&
    event.sequence <= options.fromSequence
  ) {
    return null;
  }

  return event;
}
