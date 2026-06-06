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

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const DETACH_BYTE = 0x1d;

export function runAttachedTerminalSession(input: {
  readonly application: T3Application["Service"];
  readonly terminal: TerminalAttachTarget;
}) {
  return Effect.gen(function* () {
    if (!process.stdin.isTTY || !process.stdout.isTTY || process.stdin.setRawMode === undefined) {
      return yield* Effect.fail(
        new Error("terminal attach requires an interactive TTY on stdin and stdout"),
      );
    }

    const cols = process.stdout.columns ?? DEFAULT_COLS;
    const rows = process.stdout.rows ?? DEFAULT_ROWS;
    const stream = input.application.attachTerminal({
      terminal: input.terminal,
      cols,
      rows,
    });

    return yield* Effect.callback<void, Error>((resume) => {
      let settled = false;
      const stdin = process.stdin;
      const stdout = process.stdout;
      stdin.resume();
      stdin.setRawMode(true);

      const streamFiber = Effect.runFork(
        Stream.runForEach(stream, (event) =>
          Effect.sync(() => {
            applyAttachEvent(event);
          }),
        ).pipe(
          Effect.match({
            onFailure: (error) => finish(error instanceof Error ? error : new Error(String(error))),
            onSuccess: () => finish(),
          }),
        ),
      );

      const cleanup = () => {
        stdin.off("data", onData);
        process.off("SIGWINCH", onResize);
        stdin.setRawMode(false);
        stdin.pause();
      };

      const finish = (error?: Error, message?: string) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        if (message !== undefined) {
          writeSystemMessage(message);
        }
        Effect.runFork(Fiber.interrupt(streamFiber));
        resume(error !== undefined ? Effect.fail(error) : Effect.void);
      };

      const sendResize = () => {
        const nextCols = stdout.columns ?? DEFAULT_COLS;
        const nextRows = stdout.rows ?? DEFAULT_ROWS;
        void Effect.runPromise(
          input.application.resizeTerminal({
            terminal: input.terminal,
            cols: nextCols,
            rows: nextRows,
          }),
        ).catch(() => undefined);
      };

      const onResize = () => {
        sendResize();
      };

      const onData = (chunk: Buffer | string) => {
        const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        const detachOffset = buffer.indexOf(DETACH_BYTE);
        const payload = detachOffset === -1 ? buffer : buffer.subarray(0, detachOffset);
        if (payload.length > 0) {
          void Effect.runPromise(
            input.application.writeTerminal({
              terminal: input.terminal,
              data: payload.toString("utf8"),
            }),
          ).catch((error) => finish(error instanceof Error ? error : new Error(String(error))));
        }
        if (detachOffset !== -1) {
          finish(undefined, "detached");
        }
      };

      process.on("SIGWINCH", onResize);
      stdin.on("data", onData);

      return Effect.sync(() => {
        finish();
      });
    });
  });
}

function applyAttachEvent(event: TerminalAttachStreamEvent) {
  if (event.type === "activity") {
    return;
  }

  if (event.type === "snapshot" || event.type === "restarted") {
    process.stdout.write("\u001bc");
    if (event.snapshot.history.length > 0) {
      process.stdout.write(event.snapshot.history);
    }
    return;
  }

  if (event.type === "output") {
    process.stdout.write(event.data);
    return;
  }

  if (event.type === "cleared") {
    process.stdout.write("\u001bc");
    return;
  }

  if (event.type === "error") {
    writeSystemMessage(event.message);
    return;
  }

  if (event.type === "closed") {
    writeSystemMessage("Terminal closed");
    return;
  }

  const details = [
    typeof event.exitCode === "number" ? `code ${event.exitCode}` : null,
    typeof event.exitSignal === "number" ? `signal ${event.exitSignal}` : null,
  ]
    .filter((value): value is string => value !== null)
    .join(", ");
  writeSystemMessage(details.length > 0 ? `Process exited (${details})` : "Process exited");
}

function writeSystemMessage(message: string) {
  process.stdout.write(`\r\n[terminal] ${message}\r\n`);
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
