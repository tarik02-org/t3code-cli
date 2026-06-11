import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Command, Flag } from "effect/unstable/cli";

import { threadFlag } from "../flags.ts";
import { MissingThreadError } from "../error.ts";
import { resolveThreadId } from "../../scope/index.ts";
import { Environment } from "../../environment/service.ts";
import { T3Application } from "../../application/service.ts";
import { T3Output } from "../output/service.ts";

async function spawnBackgroundCallback(
  fromThreadId: string,
  targetThreadId: string,
  prompt: string,
): Promise<number | undefined> {
  const cliPath = process.argv[1] ?? "dist/bin.js";

  const args: string[] = [
    cliPath,
    "thread",
    "callback",
    "--from",
    fromThreadId,
    "--thread",
    targetThreadId,
    "--prompt",
    prompt,
  ];

  const cp = await import("node:child_process");
  const child = cp.spawn(process.execPath, args, {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });

  child.on("error", (err: Error) => {
    process.stderr.write(`callback spawn error: ${err.message}\n`);
  });

  child.unref();

  return child.pid ?? undefined;
}

export const callbackThreadCommand = Command.make(
  "callback",
  {
    from: Flag.string("from").pipe(Flag.withDescription("Thread ID to watch for completion")),
    thread: threadFlag,
    prompt: Flag.string("prompt").pipe(Flag.withDescription("Message to send to target thread")),
    background: Flag.boolean("background").pipe(
      Flag.withDescription("Fork and detach as background process"),
      Flag.optional,
    ),
  },
  ({ from, thread, prompt, background }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      const environment = yield* Environment;
      const output = yield* T3Output;

      const fromThreadId = from;

      const targetThreadId = resolveThreadId({
        value: Option.getOrUndefined(thread),
        env: environment.env,
      });
      if (targetThreadId === undefined) {
        return yield* Effect.fail(
          new MissingThreadError({
            message: "target thread id is required: pass --thread or set T3CODE_THREAD_ID",
          }),
        );
      }

      const isBackground = Option.getOrElse(background, () => false);
      if (isBackground) {
        const pid = yield* Effect.promise(() =>
          spawnBackgroundCallback(fromThreadId, targetThreadId, prompt),
        );
        yield* output.printInfo(
          `background callback scheduled: ${fromThreadId} -> ${targetThreadId} (pid: ${pid})`,
        );
        return undefined;
      }

      yield* output.printInfo(`watching thread ${fromThreadId} for completion...`);

      const result = yield* application.callbackThread({
        fromThreadId,
        targetThreadId,
        prompt,
      });

      yield* output.printInfo(
        `callback sent to ${result.targetThreadId} (dispatch: ${result.dispatch.sequence})`,
      );
      return undefined;
    }),
).pipe(Command.withDescription("watch a thread and send a message when it completes"));
