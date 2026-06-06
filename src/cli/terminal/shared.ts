import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import type {
  TerminalAttachStreamEvent,
  TerminalSessionSnapshot,
  TerminalSummary,
} from "#t3tools/contracts";

import type {
  T3Application,
  TerminalAttachTarget,
  TerminalRef,
} from "../../application/service.ts";
import type { ApplicationError } from "../../application/error.ts";
import { TerminalCliError, TerminalIoError } from "./error.ts";
import { TerminalIo } from "./io-service.ts";

const DETACH_BYTE = 0x1d;
const ANSI_CLEAR_SCREEN = "\u001bc";

export function runAttachedTerminalSession(input: {
  readonly application: T3Application["Service"];
  readonly terminal: TerminalAttachTarget;
}) {
  return Effect.gen(function* () {
    const io = yield* TerminalIo;
    const { cols, rows } = yield* io.getWindowSize.pipe(
      Effect.mapError((error) => mapTerminalIoError(error, input.terminal)),
    );
    const stream = input.application.attachTerminal({
      terminal: input.terminal,
      cols,
      rows,
    });

    return yield* Effect.callback<void, ApplicationError | TerminalCliError>((resume) => {
      let settled = false;

      const streamFiber = Effect.runFork(
        Stream.runForEach(stream, (event) => applyAttachEvent(io, event)).pipe(
          Effect.match({
            onFailure: (error) => finish(error),
            onSuccess: () => finish(),
          }),
        ),
      );

      const finish = (error?: ApplicationError | TerminalCliError, message?: string) => {
        if (settled) {
          return;
        }
        settled = true;
        if (message !== undefined) {
          Effect.runFork(writeSystemMessage(io, message));
        }
        Effect.runFork(Fiber.interrupt(streamFiber));
        resume(error !== undefined ? Effect.fail(error) : Effect.void);
      };

      const session = io
        .withRawSession({
          onResize: ({ cols: nextCols, rows: nextRows }) =>
            input.application.resizeTerminal({
              terminal: input.terminal,
              cols: nextCols,
              rows: nextRows,
            }),
          onData: (buffer: Buffer) => {
            const detachOffset = buffer.indexOf(DETACH_BYTE);
            const payload = detachOffset === -1 ? buffer : buffer.subarray(0, detachOffset);
            if (payload.length === 0 && detachOffset === -1) {
              return Effect.void;
            }
            return Effect.gen(function* () {
              if (payload.length > 0) {
                yield* input.application.writeTerminal({
                  terminal: input.terminal,
                  data: payload.toString("utf8"),
                });
              }
              if (detachOffset !== -1) {
                yield* Effect.sync(() => {
                  finish(undefined, "detached");
                });
              }
            });
          },
        })
        .pipe(
          Effect.match({
            onFailure: (error) =>
              finish(
                error["_tag"] === "TerminalIoError"
                  ? mapTerminalIoError(error, input.terminal)
                  : error,
              ),
            onSuccess: () => finish(),
          }),
        );

      Effect.runFork(session);

      return Effect.sync(() => {
        finish();
      });
    });
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

function applyAttachEvent(io: TerminalIo["Service"], event: TerminalAttachStreamEvent) {
  if (event.type === "activity") {
    return Effect.void;
  }

  if (event.type === "snapshot" || event.type === "restarted") {
    return io
      .writeOutput(ANSI_CLEAR_SCREEN)
      .pipe(
        Effect.flatMap(() =>
          event.snapshot.history.length > 0 ? io.writeOutput(event.snapshot.history) : Effect.void,
        ),
      );
  }

  if (event.type === "output") {
    return io.writeOutput(event.data);
  }

  if (event.type === "cleared") {
    return io.writeOutput(ANSI_CLEAR_SCREEN);
  }

  if (event.type === "error") {
    return writeSystemMessage(io, event.message);
  }

  if (event.type === "closed") {
    return writeSystemMessage(io, "Terminal closed");
  }

  const details = [
    typeof event.exitCode === "number" ? `code ${event.exitCode}` : null,
    typeof event.exitSignal === "number" ? `signal ${event.exitSignal}` : null,
  ]
    .filter((value): value is string => value !== null)
    .join(", ");
  return writeSystemMessage(
    io,
    details.length > 0 ? `Process exited (${details})` : "Process exited",
  );
}

function writeSystemMessage(io: TerminalIo["Service"], message: string) {
  return io.writeOutput(`\r\n[terminal] ${message}\r\n`);
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
