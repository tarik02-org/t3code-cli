import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { TerminalIoError } from "./error.ts";
import { TerminalIo, type TerminalWindowSize } from "./io-service.ts";

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

export const NodeTerminalIoLive = Layer.succeed(TerminalIo, {
  getWindowSize: Effect.gen(function* () {
    if (!process.stdin.isTTY || !process.stdout.isTTY || process.stdin.setRawMode === undefined) {
      return yield* Effect.fail(
        new TerminalIoError({
          message: "terminal attach requires an interactive TTY on stdin and stdout",
        }),
      );
    }
    return {
      cols: process.stdout.columns ?? DEFAULT_COLS,
      rows: process.stdout.rows ?? DEFAULT_ROWS,
    } satisfies TerminalWindowSize;
  }),
  writeOutput: (text: string) =>
    Effect.sync(() => {
      process.stdout.write(text);
    }),
  withRawSession: <E>(handlers: {
    readonly onData: (chunk: Buffer) => Effect.Effect<void, E>;
    readonly onResize: (size: TerminalWindowSize) => Effect.Effect<void, E>;
  }) =>
    Effect.callback<void, E | TerminalIoError>((resume) => {
      const stdin = process.stdin;
      const stdout = process.stdout;

      if (!stdin.isTTY || !stdout.isTTY || stdin.setRawMode === undefined) {
        resume(
          Effect.fail(
            new TerminalIoError({
              message: "terminal attach requires an interactive TTY on stdin and stdout",
            }),
          ),
        );
        return Effect.void;
      }

      let settled = false;

      const cleanup = () => {
        stdin.off("data", onData);
        process.off("SIGWINCH", onResize);
        stdin.setRawMode(false);
        stdin.pause();
      };

      const finish = (effect: Effect.Effect<void, E | TerminalIoError>) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resume(effect);
      };

      const readSize = (): TerminalWindowSize => ({
        cols: stdout.columns ?? DEFAULT_COLS,
        rows: stdout.rows ?? DEFAULT_ROWS,
      });

      const onResize = () => {
        Effect.runFork(
          handlers.onResize(readSize()).pipe(
            Effect.match({
              onFailure: (error) => finish(Effect.fail(error)),
              onSuccess: () => undefined,
            }),
          ),
        );
      };

      const onData = (chunk: Buffer | string) => {
        const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        Effect.runFork(
          handlers.onData(buffer).pipe(
            Effect.match({
              onFailure: (error) => finish(Effect.fail(error)),
              onSuccess: () => undefined,
            }),
          ),
        );
      };

      stdin.resume();
      stdin.setRawMode(true);
      process.on("SIGWINCH", onResize);
      stdin.on("data", onData);

      return Effect.sync(() => {
        finish(Effect.void);
      });
    }),
});
