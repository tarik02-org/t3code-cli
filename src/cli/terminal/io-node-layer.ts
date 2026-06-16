import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { TerminalIoError } from "./error.ts";
import { TerminalIo, type RawTerminalIoSession, type TerminalWindowSize } from "./io-service.ts";

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const INTERACTIVE_TTY_MESSAGE = "terminal attach requires an interactive TTY on stdin and stdout";

const requireInteractiveTty = Effect.gen(function* () {
  if (!process.stdin.isTTY || !process.stdout.isTTY || process.stdin.setRawMode === undefined) {
    return yield* Effect.fail(new TerminalIoError({ message: INTERACTIVE_TTY_MESSAGE }));
  }

  return {
    stdin: process.stdin,
    stdout: process.stdout,
  };
});

export const NodeTerminalIoLive = Layer.succeed(TerminalIo, {
  getWindowSize: requireInteractiveTty.pipe(Effect.map(readWindowSize)),
  writeOutput: (text: string) =>
    Effect.sync(() => {
      process.stdout.write(text);
    }),
  openRawSession: Effect.acquireRelease(
    Effect.gen(function* () {
      const tty = yield* requireInteractiveTty;
      const input = yield* Queue.unbounded<Uint8Array>();
      const resize = yield* Queue.unbounded<TerminalWindowSize>();

      const onResize = () => {
        Effect.runFork(Queue.offer(resize, readWindowSize(tty)).pipe(Effect.ignore));
      };

      const onData = (chunk: Buffer | string) => {
        Effect.runFork(
          Queue.offer(input, typeof chunk === "string" ? Buffer.from(chunk) : chunk).pipe(
            Effect.ignore,
          ),
        );
      };

      tty.stdin.resume();
      tty.stdin.setRawMode(true);
      process.on("SIGWINCH", onResize);
      tty.stdin.on("data", onData);

      return {
        tty,
        input,
        resize,
        onData,
        onResize,
        session: {
          input: Stream.fromQueue(input),
          resize: Stream.fromQueue(resize),
        } satisfies RawTerminalIoSession,
      };
    }),
    ({ tty, input, resize, onData, onResize }) =>
      Effect.gen(function* () {
        tty.stdin.off("data", onData);
        process.off("SIGWINCH", onResize);
        tty.stdin.setRawMode(false);
        tty.stdin.pause();
        yield* Queue.shutdown(input);
        yield* Queue.shutdown(resize);
      }),
  ).pipe(Effect.map(({ session }) => session)),
});

function readWindowSize(tty: { readonly stdout: NodeJS.WriteStream }): TerminalWindowSize {
  return {
    cols: tty.stdout.columns ?? DEFAULT_COLS,
    rows: tty.stdout.rows ?? DEFAULT_ROWS,
  };
}
